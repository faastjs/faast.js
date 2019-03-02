import { AbortController } from "abort-controller";
import * as sys from "child_process";
import { Gaxios, GaxiosError, GaxiosOptions, GaxiosPromise } from "gaxios";
import {
    cloudbilling_v1,
    cloudfunctions_v1,
    google,
    GoogleApis,
    pubsub_v1
} from "googleapis";
import * as util from "util";
import { caches } from "../cache";
import { CostBreakdown, CostMetric } from "../cost";
import { log } from "../log";
import { packer, PackerResult } from "../packer";
import {
    CleanupOptions,
    CloudFunctionImpl,
    CommonOptionDefaults,
    CommonOptions,
    FunctionCounters,
    FunctionStats,
    Invocation,
    PollResult,
    ResponseMessage,
    SendableMessage,
    UUID
} from "../provider";
import {
    assertNever,
    computeHttpResponseBytes,
    hasExpired,
    keys,
    sleep,
    uuidv4Pattern
} from "../shared";
import { retry, throttle } from "../throttle";
import { Mutable } from "../types";
import { WrapperOptions } from "../wrapper";
import { publishPubSub, publishResponseMessage, receiveMessages } from "./google-queue";
import * as googleTrampolineHttps from "./google-trampoline-https";
import * as googleTrampolineQueue from "./google-trampoline-queue";

import CloudFunctions = cloudfunctions_v1;
import PubSubApi = pubsub_v1;
import CloudBilling = cloudbilling_v1;

const gaxios = new Gaxios();

/**
 * Google-specific options
 * @public
 */
export interface GoogleOptions extends CommonOptions {
    /**
     * The region to create resources in. Garbage collection is also limited to
     * this region. Default: `"us-central1"`.
     */
    region?: string;
    /**
     * Additional options to pass to Google Cloud Function creation.
     * @remarks
     * If you need specialized options, you can pass them to the Google Cloud
     * Functions API directly. Note that if you override any settings set by
     * faast.js, you may cause faast.js to not work:
     *
     * ```typescript
     *  const requestBody: CloudFunctions.Schema$CloudFunction = {
     *      name,
     *      entryPoint: "trampoline",
     *      timeout,
     *      availableMemoryMb,
     *      sourceUploadUrl,
     *      runtime: "nodejs8",
     *      ...googleCloudFunctionOptions
     *  };
     * ```
     *
     */
    googleCloudFunctionOptions?: CloudFunctions.Schema$CloudFunction;

    /** @internal */
    gcWorker?: (services: GoogleServices, resources: GoogleResources) => Promise<void>;
}

export interface GoogleResources {
    trampoline: string;
    requestQueueTopic?: string;
    responseQueueTopic?: string;
    responseSubscription?: string;
    region: string;
}

export interface GoogleCloudPricing {
    perInvocation: number;
    perGhzSecond: number;
    perGbSecond: number;
    perGbOutboundData: number;
    perGbPubSub: number;
}

export class GoogleMetrics {
    outboundBytes = 0;
    pubSubBytes = 0;
}

export interface GoogleServices {
    readonly cloudFunctions: CloudFunctions.Cloudfunctions;
    readonly pubsub: PubSubApi.Pubsub;
    readonly google: GoogleApis;
    readonly cloudBilling: CloudBilling.Cloudbilling;
}

export interface GoogleState {
    resources: GoogleResources;
    services: GoogleServices;
    url?: string;
    project: string;
    functionName: string;
    metrics: GoogleMetrics;
    options: Required<GoogleOptions>;
    gcPromise?: Promise<void>;
}

function gcWorkerDefault(services: GoogleServices, resources: GoogleResources) {
    return deleteResources(services, resources, log.gc);
}

export const defaults: Required<GoogleOptions> = {
    ...CommonOptionDefaults,
    region: "us-central1",
    googleCloudFunctionOptions: {},
    gcWorker: gcWorkerDefault
};

export const GoogleImpl: CloudFunctionImpl<GoogleOptions, GoogleState> = {
    name: "google",
    initialize,
    defaults,
    cleanup,
    costEstimate,
    logUrl,
    invoke,
    publish,
    poll,
    responseQueueId
};

export async function initializeGoogleServices(): Promise<GoogleServices> {
    google.options({ retryConfig: { retry: 10 } });
    const auth = await google.auth.getClient({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });

    google.options({ auth });
    return {
        cloudFunctions: google.cloudfunctions("v1"),
        pubsub: google.pubsub("v1"),
        cloudBilling: google.cloudbilling("v1"),
        google
    };
}

interface PollOptions {
    maxRetries?: number;
    delay?: (retries: number) => Promise<void>;
}

interface PollConfig<T> extends PollOptions {
    request: () => Promise<T>;
    checkDone: (result: T) => boolean;
}

async function defaultPollDelay(retries: number) {
    if (retries > 5) {
        await sleep(5 * 1000);
    }
    await sleep((retries + 1) * 100);
}

async function pollOperation<T>({
    request,
    checkDone,
    delay = defaultPollDelay,
    maxRetries = 50
}: PollConfig<T>): Promise<T | undefined> {
    let retries = 0;
    await delay(retries);
    while (true) {
        log.info(`Polling...`);
        const result = await request();
        if (checkDone(result)) {
            log.info(`Done.`);
            return result;
        }
        if (retries++ >= maxRetries) {
            throw new Error(`Timed out after ${retries} attempts.`);
        }
        await delay(retries);
    }
}

async function quietly<T>(promise: GaxiosPromise<T>) {
    try {
        const result = await promise;
        return result.data;
    } catch (err) {
        return;
    }
}

async function waitFor(
    api: CloudFunctions.Cloudfunctions,
    response: GaxiosPromise<CloudFunctions.Schema$Operation>
) {
    const operationName = (await response).data.name!;
    return pollOperation({
        request: () => quietly(api.operations.get({ name: operationName })),
        checkDone: result => {
            if (!result || result.error) {
                return false;
            }
            return result.done || false;
        }
    });
}

async function deleteFunction(api: CloudFunctions.Cloudfunctions, path: string) {
    return waitFor(
        api,
        api.projects.locations.functions.delete({
            name: path
        })
    );
}

export async function initialize(
    fmodule: string,
    nonce: UUID,
    options: Required<GoogleOptions>
): Promise<GoogleState> {
    log.info(`Create google cloud function`);
    const services = await initializeGoogleServices();
    const project = await google.auth.getProjectId();
    const { cloudFunctions, pubsub } = services;
    const { region, childProcess, timeout } = options;

    log.info(`Nonce: ${nonce}`);
    const location = `projects/${project}/locations/${region}`;

    async function createCodeBundle() {
        const wrapperOptions = {
            childProcessTimeoutMs: timeout * 1000 - 100
        };
        const { archive } = await googlePacker(fmodule, options, wrapperOptions);
        const uploadUrlResponse = await cloudFunctions.projects.locations.functions.generateUploadUrl(
            {
                parent: location
            }
        );

        const uploadResult = await uploadZip(uploadUrlResponse.data.uploadUrl!, archive);
        log.info(`Upload zip file response: ${uploadResult.statusText}`);
        return uploadUrlResponse.data.uploadUrl;
    }

    const functionName = "faast-" + nonce;
    const trampoline = `projects/${project}/locations/${region}/functions/${functionName}`;

    const resources: Mutable<GoogleResources> = {
        trampoline,
        region
    };
    const state: GoogleState = {
        resources,
        services,
        project,
        functionName,
        metrics: new GoogleMetrics(),
        options
    };

    const { gc, retentionInDays, gcWorker } = options;
    if (gc) {
        log.gc(`Starting garbage collector`);
        state.gcPromise = collectGarbage(gcWorker, services, project, retentionInDays);
        state.gcPromise.catch(_silenceWarningLackOfSynchronousCatch => {});
    }

    const pricingPromise = getGoogleCloudFunctionsPricing(services.cloudBilling, region);

    const { mode } = options;

    const responseQueuePromise = (async () => {
        const topic = await pubsub.projects.topics.create({
            name: getResponseQueueTopic(project, functionName)
        });

        resources.responseQueueTopic = topic.data.name;
        resources.responseSubscription = getResponseSubscription(project, functionName);
        log.info(`Creating response queue subscription`);
        await pubsub.projects.subscriptions.create({
            name: resources.responseSubscription,
            requestBody: {
                topic: resources.responseQueueTopic
            }
        });
    })();

    let requestQueuePromise;
    if (mode === "queue") {
        log.info(`Initializing queue`);
        resources.requestQueueTopic = getRequestQueueTopic(project, functionName);
        requestQueuePromise = pubsub.projects.topics.create({
            name: resources.requestQueueTopic
        });
    }

    const sourceUploadUrl = await createCodeBundle();
    const { memorySize, googleCloudFunctionOptions } = options;
    const requestBody: CloudFunctions.Schema$CloudFunction = {
        name: trampoline,
        entryPoint: "trampoline",
        timeout: `${timeout}s`,
        availableMemoryMb: memorySize,
        sourceUploadUrl,
        runtime: "nodejs8",
        ...googleCloudFunctionOptions
    };
    if (mode === "queue") {
        await requestQueuePromise;
        requestBody.eventTrigger = {
            eventType: "providers/cloud.pubsub/eventTypes/topic.publish",
            resource: resources.requestQueueTopic
        };
    } else {
        requestBody.httpsTrigger = {};
    }
    validateGoogleLabels(requestBody.labels);
    log.info(`Create function at ${location}`);
    log.info(`Request body: %O`, requestBody);
    try {
        log.info(`create function ${requestBody.name}`);
        await retry(1, () =>
            waitFor(
                cloudFunctions,
                cloudFunctions.projects.locations.functions.create({
                    location,
                    requestBody
                })
            )
        );
    } catch (err) {
        log.warn(`createFunction error: ${err.stack}`);
        log.info(`delete function ${trampoline}`);
        await deleteFunction(cloudFunctions, trampoline).catch(() => {});
        throw err;
    }
    if (mode === "https" || mode === "auto") {
        const func = await cloudFunctions.projects.locations.functions.get({
            name: trampoline
        });

        if (!func.data.httpsTrigger) {
            throw new Error("Could not get http trigger url");
        }
        const { url } = func.data.httpsTrigger!;
        if (!url) {
            throw new Error("Could not get http trigger url");
        }
        log.info(`Function URL: ${url}`);
        state.url = url;
    }
    await pricingPromise;
    await responseQueuePromise;
    return state;
}

function getRequestQueueTopic(project: string, functionName: string) {
    return `projects/${project}/topics/${functionName}-Requests`;
}

function getResponseQueueTopic(project: string, functionName: string) {
    return `projects/${project}/topics/${functionName}-Responses`;
}

function getResponseSubscription(project: string, functionName: string) {
    return `projects/${project}/subscriptions/${functionName}-Responses`;
}

export function exec(cmd: string) {
    const result = sys.execSync(cmd).toString();
    log.info(result);
    return result;
}

async function callFunctionHttps(
    url: string,
    call: Invocation,
    metrics: GoogleMetrics,
    cancel: Promise<void>
): Promise<ResponseMessage | void> {
    const source = new AbortController();

    const shouldRetry = (err: GaxiosError) => {
        if (err.response) {
            const { status } = err.response;
            return status !== 503 && status !== 408;
        }
        return false;
    };

    try {
        const axiosConfig: GaxiosOptions = {
            method: "PUT",
            url,
            headers: { "Content-Type": "text/plain" },
            body: call.body,
            signal: source.signal
        };
        const rawResponse = await Promise.race([
            gaxios.request<string>(axiosConfig),
            cancel
        ]);

        if (!rawResponse) {
            log.info(`cancelling gcp invoke`);
            source.abort();
            return;
        }
        const returned: string = rawResponse.data;
        metrics.outboundBytes += computeHttpResponseBytes(rawResponse!.headers);
        return {
            kind: "response",
            callId: call.callId,
            body: returned,
            rawResponse,
            timestamp: Date.now()
        };
    } catch (err) {
        const { response } = err;
        let error = err;
        if (response) {
            const interpretation =
                response && response.status === 503
                    ? " (faast: possibly out of memory error)"
                    : "";
            error = new Error(
                `${response.status} ${response.statusText} ${
                    response.data
                }${interpretation}`
            );
        }
        throw error;
    }
}

async function invoke(
    state: GoogleState,
    call: Invocation,
    cancel: Promise<void>
): Promise<ResponseMessage | void> {
    const { options, resources, services, url, metrics } = state;
    switch (options.mode) {
        case "auto":
        case "https":
            // XXX Use response queue even with https mode?
            return callFunctionHttps(url!, call, metrics, cancel);
        case "queue":
            const { requestQueueTopic } = resources;
            const { pubsub } = services;
            publishPubSub(pubsub, requestQueueTopic!, call.body);
            return;
        default:
            assertNever(options.mode);
    }
}

async function publish(state: GoogleState, message: SendableMessage): Promise<void> {
    const { services, resources } = state;
    const { pubsub } = services;
    const queue = resources.responseQueueTopic!;
    return publishResponseMessage(pubsub, queue, message);
}

function poll(state: GoogleState, cancel: Promise<void>): Promise<PollResult> {
    return receiveMessages(
        state.services.pubsub,
        state.resources.responseSubscription!,
        state.metrics,
        cancel
    );
}

function responseQueueId(state: GoogleState): string | undefined {
    return state.resources.responseQueueTopic;
}

async function deleteResources(
    services: GoogleServices,
    resources: GoogleResources,
    output: (msg: string) => void = log.info
) {
    const {
        trampoline,
        requestQueueTopic,
        responseSubscription,
        responseQueueTopic,
        region,
        ...rest
    } = resources;
    const _exhaustiveCheck: Required<typeof rest> = {};
    const { cloudFunctions, pubsub } = services;

    if (responseSubscription) {
        if (
            await quietly(
                pubsub.projects.subscriptions.delete({
                    subscription: responseSubscription
                })
            )
        ) {
            output(`Deleted response subscription: ${responseSubscription}`);
        }
    }
    if (responseQueueTopic) {
        if (await quietly(pubsub.projects.topics.delete({ topic: responseQueueTopic }))) {
            output(`Deleted response queue topic: ${responseQueueTopic}`);
        }
    }
    if (requestQueueTopic) {
        if (await quietly(pubsub.projects.topics.delete({ topic: requestQueueTopic }))) {
            output(`Deleted request queue topic: ${requestQueueTopic}`);
        }
    }
    if (trampoline) {
        if (await deleteFunction(cloudFunctions, trampoline)) {
            output(`Deleted function ${trampoline}`);
        }
    }
}

export async function cleanup(state: GoogleState, options: CleanupOptions) {
    log.info(`google cleanup starting.`);
    if (state.gcPromise) {
        log.info(`Waiting for garbage collection...`);
        await state.gcPromise;
        log.info(`Garbage collection done.`);
    }

    if (options.deleteResources) {
        await deleteResources(state.services, state.resources);
    }
    log.info(`google cleanup done.`);
}

let garbageCollectorRunning = false;

async function collectGarbage(
    gcWorker: (services: GoogleServices, resources: GoogleResources) => Promise<void>,
    services: GoogleServices,
    project: string,
    retentionInDays: number
) {
    if (gcWorker === gcWorkerDefault) {
        if (garbageCollectorRunning) {
            return;
        }
        garbageCollectorRunning = true;
    }
    try {
        const { cloudFunctions } = services;

        let pageToken: string | undefined;

        let promises = [];
        const scheduleDeleteResources = throttle(
            {
                concurrency: 5,
                rate: 5,
                burst: 2
            },
            async (services: GoogleServices, fn: CloudFunctions.Schema$CloudFunction) => {
                const { region, name, project } = parseFunctionName(fn.name!)!;

                const resources: GoogleResources = {
                    region,
                    trampoline: fn.name!,
                    requestQueueTopic: getRequestQueueTopic(project, name),
                    responseQueueTopic: getResponseQueueTopic(project, name),
                    responseSubscription: getResponseSubscription(project, name)
                };
                await gcWorker(services, resources);
            }
        );

        const fnPattern = new RegExp(`/functions/faast-${uuidv4Pattern}$`);
        do {
            const funcListResponse = await cloudFunctions.projects.locations.functions.list(
                {
                    parent: `projects/${project}/locations/-`,
                    pageToken
                }
            );

            pageToken = funcListResponse.data.nextPageToken;
            const garbageFunctions = (funcListResponse.data.functions || [])
                .filter(fn => hasExpired(fn.updateTime, retentionInDays))
                .filter(fn => fn.name!.match(fnPattern));

            promises = garbageFunctions.map(fn => scheduleDeleteResources(services, fn));
        } while (pageToken);

        await Promise.all(promises);
    } finally {
        if (gcWorker === gcWorkerDefault) {
            garbageCollectorRunning = false;
        }
    }
}

function parseFunctionName(path: string) {
    const match = path.match(/^projects\/(.*)\/locations\/(.*)\/functions\/(.*)$/);
    return match && { project: match[1], region: match[2], name: match[3] };
}

/**
 * @param labels The labels applied to a resource must meet the following
 * requirements:
 *
 * Each resource can have multiple labels, up to a maximum of 64. Each label
 * must be a key-value pair. Keys have a minimum length of 1 character and a
 * maximum length of 63 characters, and cannot be empty. Values can be empty,
 * and have a maximum length of 63 characters. Keys and values can contain only
 * lowercase letters, numeric characters, underscores, and dashes. All
 * characters must use UTF-8 encoding, and international characters are allowed.
 * The key portion of a label must be unique. However, you can use the same key
 * with multiple resources. Keys must start with a lowercase letter or
 * international character. For a given reporting service and project, the
 * number of distinct key-value pair combinations that will be preserved within
 * a one-hour window is 1,000. For example, the Compute Engine service reports
 * metrics on virtual machine (VM) instances. If you deploy a project with 2,000
 * VMs, each with a distinct label, the service reports metrics are preserved
 * for only the first 1,000 labels that exist within the one-hour window.
 */
function validateGoogleLabels(labels: { [key: string]: string } | undefined) {
    if (!labels) {
        return;
    }
    const keys = Object.keys(labels);
    if (keys.length > 64) {
        throw new Error("Cannot exceeded 64 labels");
    }
    if (keys.find(key => typeof key !== "string" || typeof labels[key] !== "string")) {
        throw new Error(`Label keys and values must be strings`);
    }
    if (keys.find(key => key.length > 63 || labels[key].length > 63)) {
        throw new Error(`Label keys and values cannot exceed 63 characters`);
    }
    if (keys.find(key => key.length === 0)) {
        throw new Error(`Label keys must have length > 0`);
    }
    const pattern = /^[a-z0-9_-]*$/;
    if (keys.find(key => !key.match(pattern) || !labels[key].match(pattern))) {
        throw new Error(
            `Label keys and values can contain only lowercase letters, numeric characters, underscores, and dashes.`
        );
    }
}

async function uploadZip(url: string, zipStream: NodeJS.ReadableStream) {
    const config: GaxiosOptions = {
        method: "PUT",
        url,
        body: zipStream,
        headers: {
            "content-type": "application/zip",
            "x-goog-content-length-range": "0,104857600"
        },
        retryConfig: {
            retry: 5
        }
    };
    return gaxios.request(config);
}

export async function googlePacker(
    functionModule: string,
    options: GoogleOptions,
    wrapperOptions: WrapperOptions
): Promise<PackerResult> {
    const { mode } = options;
    const trampolineModule =
        mode === "queue" ? googleTrampolineQueue : googleTrampolineHttps;
    return packer(trampolineModule, functionModule, options, wrapperOptions);
}

const getGooglePrice = throttle(
    { concurrency: 1, rate: 3, retry: 3, memoize: true, cache: caches.googlePrices },
    async function(
        cloudBilling: CloudBilling.Cloudbilling,
        region: string,
        serviceName: string,
        description: string,
        conversionFactor: number
    ) {
        try {
            const skusResponse = await cloudBilling.services.skus.list({
                parent: serviceName
            });
            const { skus = [] } = skusResponse.data;
            const matchingSkus = skus.filter(sku => sku.description === description);
            log.provider(`matching SKUs: ${util.inspect(matchingSkus, { depth: null })}`);

            const regionOrGlobalSku =
                matchingSkus.find(sku => sku.serviceRegions![0] === region) ||
                matchingSkus.find(sku => sku.serviceRegions![0] === "global");

            const pexp = regionOrGlobalSku!.pricingInfo![0].pricingExpression!;
            const prices = pexp.tieredRates!.map(
                rate =>
                    Number(rate.unitPrice!.units || "0") + rate.unitPrice!.nanos! / 1e9
            );
            const price =
                Math.max(...prices) * (conversionFactor / pexp.baseUnitConversionFactor!);
            log.provider(
                `Found price for ${serviceName}, ${description}, ${region}: ${price}`
            );
            return price;
        } catch (err) {
            const { message: m } = err;
            if (!m.match(/socket hang up/)) {
                log.warn(
                    `Could not get Google Cloud Functions pricing for '${description}'`
                );
                log.warn(err);
            }
            throw err;
        }
    }
);

let googleServices: cloudbilling_v1.Schema$Service[] | undefined;

const listGoogleServices = throttle(
    { concurrency: 1 },
    async (cloudBilling: CloudBilling.Cloudbilling) => {
        if (googleServices) {
            return googleServices;
        }
        const response = await cloudBilling.services.list();
        googleServices = response.data.services!;
        return googleServices;
    }
);

async function getGoogleCloudFunctionsPricing(
    cloudBilling: CloudBilling.Cloudbilling,
    region: string
): Promise<GoogleCloudPricing> {
    try {
        const services = await listGoogleServices(cloudBilling);

        const getPricing = (
            serviceName: string,
            description: string,
            conversionFactor: number = 1
        ) => {
            const service = services.find(s => s.displayName === serviceName)!;

            return getGooglePrice(
                cloudBilling,
                region,
                service.name!,
                description,
                conversionFactor
            );
        };

        return {
            perInvocation: await getPricing("Cloud Functions", "Invocations"),
            perGhzSecond: await getPricing("Cloud Functions", "CPU Time"),
            perGbSecond: await getPricing("Cloud Functions", "Memory Time", 2 ** 30),
            perGbOutboundData: await getPricing(
                "Cloud Functions",
                `Network Egress from ${region}`,
                2 ** 30
            ),
            perGbPubSub: await getPricing(
                "Cloud Pub/Sub",
                "Message Delivery Basic",
                2 ** 30
            )
        };
    } catch (err) {
        log.warn(`Could not get Google Cloud Functions pricing`);
        log.warn(err);
        return {
            perInvocation: 0,
            perGhzSecond: 0,
            perGbSecond: 0,
            perGbOutboundData: 0,
            perGbPubSub: 0
        };
    }
}

// https://cloud.google.com/functions/pricing
const gcfProvisonableMemoryTable: { [mem: number]: number } = {
    128: 0.2,
    256: 0.4,
    512: 0.8,
    1024: 1.4,
    2048: 2.4
};

async function costEstimate(
    state: GoogleState,
    counters: FunctionCounters,
    stats: FunctionStats
): Promise<CostBreakdown> {
    const costs = new CostBreakdown();
    const { memorySize = defaults.memorySize } = state.options;
    const provisionableSizes = keys(gcfProvisonableMemoryTable)
        .map(n => Number(n))
        .sort((a, b) => a - b);
    const provisionedMb = provisionableSizes.find(size => memorySize <= size);
    if (!provisionedMb) {
        log.warn(
            `Could not determine provisioned memory or CPU for requested memory size ${memorySize}`
        );
    }
    const provisionedGhz = gcfProvisonableMemoryTable[provisionedMb!];
    const billedTimeStats = stats.estimatedBilledTime;
    const seconds = (billedTimeStats.mean / 1000) * billedTimeStats.samples;

    const { region } = state.resources;
    const prices = await getGoogleCloudFunctionsPricing(
        state.services.cloudBilling,
        region
    );

    const provisionedGb = provisionedMb! / 1024;
    const functionCallDuration = new CostMetric({
        name: "functionCallDuration",
        pricing:
            prices.perGbSecond * provisionedGb + prices.perGhzSecond * provisionedGhz,
        unit: "second",
        measured: seconds,
        comment: `https://cloud.google.com/functions/pricing#compute_time (${provisionedMb} MB, ${provisionedGhz} GHz)`
    });
    costs.push(functionCallDuration);

    const functionCallRequests = new CostMetric({
        name: "functionCallRequests",
        pricing: prices.perInvocation,
        measured: counters.invocations,
        unit: "request",
        comment: "https://cloud.google.com/functions/pricing#invocations"
    });
    costs.push(functionCallRequests);

    const outboundDataTransfer = new CostMetric({
        name: "outboundDataTransfer",
        pricing: prices.perGbOutboundData,
        measured: state.metrics.outboundBytes / 2 ** 30,
        unit: "GB",
        comment: "https://cloud.google.com/functions/pricing#networking"
    });
    costs.push(outboundDataTransfer);

    const pubsub = new CostMetric({
        name: "pubsub",
        pricing: prices.perGbPubSub,
        measured: state.metrics.pubSubBytes / 2 ** 30,
        unit: "GB",
        comment: "https://cloud.google.com/pubsub/pricing"
    });
    costs.push(pubsub);

    return costs;
}

export function logUrl(state: GoogleState) {
    const { project, functionName } = state;
    return `https://console.cloud.google.com/logs/viewer?project=${project}&resource=cloud_function%2Ffunction_name%2F${functionName}`;
}
