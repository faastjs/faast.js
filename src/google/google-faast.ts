import Axios, { AxiosError, AxiosPromise, AxiosRequestConfig } from "axios";
import * as sys from "child_process";
import {
    cloudbilling_v1,
    cloudfunctions_v1,
    google,
    GoogleApis,
    pubsub_v1
} from "googleapis";
import * as util from "util";
import { CostBreakdown, CostMetric } from "../cost";
import { info, logGc, logPricing, warn } from "../log";
import { packer, PackerResult } from "../packer";
import {
    CloudFunctionImpl,
    FunctionCounters,
    FunctionStats,
    Invocation,
    PollResult,
    ResponseMessage,
    SendableMessage,
    CommonOptions,
    CommonOptionDefaults,
    CleanupOptions,
    UUID,
    PackerOptionDefaults
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
import { publishPubSub, receiveMessages, publishResponseMessage } from "./google-queue";
import * as googleTrampolineHttps from "./google-trampoline-https";
import * as googleTrampolineQueue from "./google-trampoline-queue";

import CloudFunctions = cloudfunctions_v1;
import PubSubApi = pubsub_v1;
import CloudBilling = cloudbilling_v1;
import { caches } from "../cache";

export interface Options extends CommonOptions {
    region?: string;
    googleCloudFunctionOptions?: CloudFunctions.Schema$CloudFunction;
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

export interface State {
    resources: GoogleResources;
    services: GoogleServices;
    url?: string;
    project: string;
    functionName: string;
    pricing?: GoogleCloudPricing;
    metrics: GoogleMetrics;
    options: Required<Options>;
    gcPromise?: Promise<void>;
}

function gcWorkerDefault(services: GoogleServices, resources: GoogleResources) {
    return deleteResources(services, resources, logGc);
}

export const defaults: Required<Options> = {
    ...CommonOptionDefaults,
    region: "us-central1",
    googleCloudFunctionOptions: {},
    gcWorker: gcWorkerDefault
};

export const Impl: CloudFunctionImpl<Options, State> = {
    name: "google",
    initialize,
    pack,
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
        info(`Polling...`);
        const result = await request();
        if (checkDone(result)) {
            info(`Done.`);
            return result;
        }
        if (retries++ >= maxRetries) {
            throw new Error(`Timed out after ${retries} attempts.`);
        }
        await delay(retries);
    }
}

async function carefully<T>(promise: AxiosPromise<T>) {
    try {
        const result = await promise;
        return result.data;
    } catch (err) {
        warn(err);
        throw err;
    }
}

async function quietly<T>(promise: AxiosPromise<T>) {
    try {
        const result = await promise;
        return result.data;
    } catch (err) {
        return;
    }
}

async function waitFor(
    api: CloudFunctions.Cloudfunctions,
    response: AxiosPromise<CloudFunctions.Schema$Operation>
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
    options: Required<Options>
): Promise<State> {
    info(`Create google cloud function`);
    const services = await initializeGoogleServices();
    const project = await google.auth.getProjectId();
    const { cloudFunctions, pubsub } = services;
    const { region } = options;

    info(`Nonce: ${nonce}`);
    const location = `projects/${project}/locations/${region}`;

    async function createCodeBundle() {
        const { archive } = await pack(fmodule, options);
        const uploadUrlResponse = await carefully(
            cloudFunctions.projects.locations.functions.generateUploadUrl({
                parent: location
            })
        );
        const uploadResult = await uploadZip(uploadUrlResponse.uploadUrl!, archive);
        info(`Upload zip file response: ${uploadResult.statusText}`);
        return uploadUrlResponse.uploadUrl;
    }

    const functionName = "faast-" + nonce;
    const trampoline = `projects/${project}/locations/${region}/functions/${functionName}`;

    const resources: Mutable<GoogleResources> = {
        trampoline,
        region
    };
    const state: State = {
        resources,
        services,
        project,
        functionName,
        metrics: new GoogleMetrics(),
        options
    };

    const { gc, retentionInDays, gcWorker } = options;
    if (gc) {
        logGc(`Starting garbage collector`);
        state.gcPromise = collectGarbage(gcWorker, services, project, retentionInDays);
        state.gcPromise.catch(_silenceWarningLackOfSynchronousCatch => {});
    }

    const pricingPromise = getGoogleCloudFunctionsPricing(services.cloudBilling, region);

    const { mode } = options;

    const responseQueuePromise = pubsub.projects.topics
        .create({ name: getResponseQueueTopic(project, functionName) })
        .then(topic => {
            resources.responseQueueTopic = topic.data.name;
            resources.responseSubscription = getResponseSubscription(
                project,
                functionName
            );
            info(`Creating response queue subscription`);
            return pubsub.projects.subscriptions.create({
                name: resources.responseSubscription,
                requestBody: {
                    topic: resources.responseQueueTopic
                }
            });
        });

    let requestQueuePromise;
    if (mode === "queue") {
        info(`Initializing queue`);
        resources.requestQueueTopic = getRequestQueueTopic(project, functionName);
        requestQueuePromise = pubsub.projects.topics.create({
            name: resources.requestQueueTopic
        });
    }

    const sourceUploadUrl = await createCodeBundle();
    const { timeout, memorySize, googleCloudFunctionOptions } = options;
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
    info(`Create function at ${location}`);
    info(`Request body: %O`, requestBody);
    try {
        info(`create function ${requestBody.name}`);
        await waitFor(
            cloudFunctions,
            cloudFunctions.projects.locations.functions.create({
                location,
                requestBody
            })
        );
    } catch (err) {
        warn(`createFunction error: ${err.stack}`);
        info(`delete function ${trampoline}`);
        await deleteFunction(cloudFunctions, trampoline).catch();
        throw err;
    }
    if (mode === "https" || mode === "auto") {
        const func = await carefully(
            cloudFunctions.projects.locations.functions.get({ name: trampoline })
        );
        if (!func || !func.httpsTrigger) {
            throw new Error("Could not get http trigger url");
        }
        const { url } = func.httpsTrigger!;
        if (!url) {
            throw new Error("Could not get http trigger url");
        }
        info(`Function URL: ${url}`);
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
    info(result);
    return result;
}

async function callFunctionHttps(
    url: string,
    call: Invocation,
    metrics: GoogleMetrics,
    cancel: Promise<void>
): Promise<ResponseMessage | void> {
    const source = Axios.CancelToken.source();

    const shouldRetry = (err: AxiosError) => {
        if (err.response) {
            const { status } = err.response;
            return status !== 503 && status !== 408;
        }
        return false;
    };

    try {
        const axiosConfig: AxiosRequestConfig = {
            headers: { "Content-Type": "text/plain" },
            cancelToken: source.token
        };
        const rawResponse = await Promise.race([
            retry(shouldRetry, () => {
                return Axios.put<string>(url!, call.body, axiosConfig);
            }),
            cancel
        ]);

        if (!rawResponse) {
            info(`cancelling gcp invoke`);
            source.cancel();
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
    state: State,
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

async function publish(state: State, message: SendableMessage): Promise<void> {
    const { services, resources } = state;
    const { pubsub } = services;
    const queue = resources.responseQueueTopic!;
    return publishResponseMessage(pubsub, queue, message);
}

function poll(state: State, cancel: Promise<void>): Promise<PollResult> {
    return receiveMessages(
        state.services.pubsub,
        state.resources.responseSubscription!,
        state.metrics,
        cancel
    );
}

function responseQueueId(state: State): string | undefined {
    return state.resources.responseQueueTopic;
}

async function deleteResources(
    services: GoogleServices,
    resources: GoogleResources,
    output: (msg: string) => void = info
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

export async function cleanup(state: State, options: CleanupOptions) {
    info(`google cleanup starting.`);
    if (state.gcPromise) {
        info(`Waiting for garbage collection...`);
        await state.gcPromise;
        info(`Garbage collection done.`);
    }

    if (options.deleteResources) {
        await deleteResources(state.services, state.resources);
    }
    info(`google cleanup done.`);
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
            const funcListResponse = await retry(3, () =>
                cloudFunctions.projects.locations.functions.list({
                    parent: `projects/${project}/locations/-`,
                    pageToken
                })
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
    return Axios.put(url, zipStream, {
        headers: {
            "content-type": "application/zip",
            "x-goog-content-length-range": "0,104857600"
        }
    });
}

export async function pack(
    functionModule: string,
    userOptions: Options = {}
): Promise<PackerResult> {
    const { mode } = userOptions;
    const trampolineModule =
        mode === "queue" ? googleTrampolineQueue : googleTrampolineHttps;
    const options = Object.assign({}, PackerOptionDefaults, userOptions);
    return packer(trampolineModule, functionModule, options);
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
            logPricing(`matching SKUs: ${util.inspect(matchingSkus, { depth: null })}`);

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
            logPricing(
                `Found price for ${serviceName}, ${description}, ${region}: ${price}`
            );
            return price;
        } catch (err) {
            const { message: m } = err;
            if (!m.match(/socket hang up/)) {
                warn(`Could not get Google Cloud Functions pricing for '${description}'`);
                warn(err);
            }
            throw err;
        }
    }
);

async function getGoogleCloudFunctionsPricing(
    cloudBilling: CloudBilling.Cloudbilling,
    region: string
): Promise<GoogleCloudPricing> {
    try {
        const services = await cloudBilling.services.list();

        const getPricing = (
            serviceName: string,
            description: string,
            conversionFactor: number = 1
        ) => {
            const service = services.data.services!.find(
                s => s.displayName === serviceName
            )!;

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
        warn(`Could not get Google Cloud Functions pricing`);
        warn(err);
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
    state: State,
    counters: FunctionCounters,
    stats: FunctionStats
): Promise<CostBreakdown> {
    const costs = new CostBreakdown();
    const { memorySize = defaults.memorySize } = state.options;
    const provisionableSizes = keys(gcfProvisonableMemoryTable)
        .map(n => Number(n))
        .sort((a, b) => a - b);
    const provisionedMb = provisionableSizes.find(size => memorySize <= size);
    logPricing(`For memory size ${memorySize}, provisioned: ${provisionedMb}`);
    if (!provisionedMb) {
        warn(
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

export function logUrl(state: State) {
    const { project, functionName } = state;
    return `https://console.cloud.google.com/logs/viewer?project=${project}&resource=cloud_function%2Ffunction_name%2F${functionName}`;
}
