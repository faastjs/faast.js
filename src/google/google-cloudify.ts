import Axios, { AxiosPromise, AxiosResponse } from "axios";
import * as sys from "child_process";
import {
    cloudbilling_v1,
    cloudfunctions_v1,
    google,
    GoogleApis,
    logging_v2,
    pubsub_v1
} from "googleapis";
import * as uuidv4 from "uuid/v4";
import {
    CloudFunctionImpl,
    CloudImpl,
    CommonOptions,
    Logger,
    Costs,
    FunctionCounters,
    FunctionStats,
    CostMetric
} from "../cloudify";
import { Funnel } from "../funnel";
import { log, warn, logPricing } from "../log";
import { LogStitcher } from "../logging";
import { packer, PackerOptions, PackerResult } from "../packer";
import * as cloudqueue from "../queue";
import { sleep, computeHttpResponseBytes } from "../shared";
import { FunctionCall, FunctionReturn, serializeCall } from "../trampoline";
import { Mutable } from "../type-helpers";
import {
    getMessageBody,
    publish,
    publishControlMessage,
    pubsubMessageAttribute,
    receiveMessages
} from "./google-queue";
import CloudFunctions = cloudfunctions_v1;
import PubSubApi = pubsub_v1;
import Logging = logging_v2;
import CloudBilling = cloudbilling_v1;

type Logging = logging_v2.Logging;

export interface Options extends CommonOptions {
    region?: string;
    googleCloudFunctionOptions?: CloudFunctions.Schema$CloudFunction;
}

export interface GoogleResources {
    trampoline: string;
    requestQueueTopic?: string;
    responseQueueTopic?: string;
    responseSubscription?: string;
    isEmulator: boolean;
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
    readonly logging: Logging.Logging;
    readonly cloudBilling: CloudBilling.Cloudbilling;
}

type ReceivedMessage = PubSubApi.Schema$ReceivedMessage;

type GoogleCloudQueueState = cloudqueue.StateWithMessageType<ReceivedMessage>;
type GoogleCloudQueueImpl = cloudqueue.QueueImpl<ReceivedMessage>;

export interface State {
    resources: GoogleResources;
    services: GoogleServices;
    queueState?: GoogleCloudQueueState;
    callFunnel: Funnel<FunctionReturn>;
    url?: string;
    project: string;
    functionName: string;
    logStitcher: LogStitcher;
    logger?: Logger;
    pricing?: GoogleCloudPricing;
    metrics: GoogleMetrics;
    options: Options;
}

export const Impl: CloudImpl<Options, State> = {
    name: "google",
    initialize,
    cleanupResources,
    pack,
    getFunctionImpl
};

export const GoogleFunctionImpl: CloudFunctionImpl<State> = {
    name: "google",
    callFunction,
    cleanup,
    stop,
    setConcurrency,
    setLogger
    // costEstimate
};

export const EmulatorImpl: CloudImpl<Options, State> = {
    ...Impl,
    initialize: initializeEmulator
};

export async function initializeGoogleServices(
    useEmulator: boolean = false
): Promise<GoogleServices> {
    const auth = await google.auth.getClient({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });
    google.options({ auth });
    return {
        cloudFunctions: useEmulator ? await getEmulator() : google.cloudfunctions("v1"),
        pubsub: google.pubsub("v1"),
        logging: google.logging("v2"),
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
    describe?: (result: T) => string;
}

async function defaultPollDelay(retries: number) {
    if (retries > 5) {
        return sleep(5 * 1000);
    }
    return sleep((retries + 1) * 100);
}

async function poll<T>({
    request,
    checkDone,
    delay = defaultPollDelay,
    maxRetries = 30
}: PollConfig<T>): Promise<T | undefined> {
    let retries = 0;
    await delay(retries);
    while (true) {
        log(`Polling...`);
        const result = await request();
        if (checkDone(result)) {
            log(`Done.`);
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

async function waitFor(
    api: CloudFunctions.Cloudfunctions,
    response: AxiosPromise<CloudFunctions.Schema$Operation>
) {
    const operationName = (await response).data.name!;
    return poll({
        request: () => carefully(api.operations.get({ name: operationName })),
        checkDone: result => {
            if (result.error) {
                throw result.error;
            }
            return result.done || false;
        }
    });
}

async function deleteFunction(api: CloudFunctions.Cloudfunctions, path: string) {
    log(`delete function ${path}`);
    return waitFor(
        api,
        api.projects.locations.functions.delete({
            name: path
        })
    );
}

export async function initialize(fmodule: string, options: Options = {}): Promise<State> {
    const services = await initializeGoogleServices();
    const project = await google.auth.getDefaultProjectId();
    return initializeWithApi(services, fmodule, options, project, false);
}

async function getEmulator(): Promise<CloudFunctions.Cloudfunctions> {
    exec("functions start");
    const output = exec(`functions status`);
    const rest = output.match(/REST Service\s+│\s+(http:\/\/localhost:\S+)/);
    if (!rest || !rest[1]) {
        throw new Error("Could not find cloud functions service REST url");
    }
    const url = rest[1];
    const DISCOVERY_URL = `${url}$discovery/rest?version=v1`;
    log(`DISCOVERY_URL: ${DISCOVERY_URL}`);
    const emulator = await google.discoverAPI(DISCOVERY_URL);
    return emulator as any;
}

export async function initializeEmulator(fmodule: string, options: Options = {}) {
    const services = await initializeGoogleServices(true);
    const project = await google.auth.getDefaultProjectId();
    return initializeWithApi(
        services,
        fmodule,
        {
            ...options,
            useQueue: false
        },
        project,
        true
    );
}

export const defaults: Required<Options> = {
    region: "us-central1",
    timeout: 60,
    memorySize: 256,
    useQueue: false,
    googleCloudFunctionOptions: {},
    addZipFile: [],
    addDirectory: [],
    packageJson: false,
    webpackOptions: {}
};

async function initializeWithApi(
    services: GoogleServices,
    serverModule: string,
    options: Options,
    project: string,
    isEmulator: boolean
): Promise<State> {
    log(`Create cloud function`);
    const { cloudFunctions } = services;
    const {
        region = defaults.region,
        timeout = defaults.timeout,
        memorySize = defaults.memorySize,
        useQueue = defaults.useQueue,
        googleCloudFunctionOptions
    } = options;
    const nonce = uuidv4();
    log(`Nonce: ${nonce}`);
    const { archive } = await pack(serverModule, options);
    const location = `projects/${project}/locations/${region}`;
    const uploadUrlResponse = await carefully(
        cloudFunctions.projects.locations.functions.generateUploadUrl({
            parent: location
        })
    );
    const uploadResult = await uploadZip(uploadUrlResponse.uploadUrl!, archive);
    log(`Upload zip file response: ${uploadResult.statusText}`);
    const functionName = "cloudify-" + nonce;
    const trampoline = `projects/${project}/locations/${region}/functions/${functionName}`;

    const resources: Mutable<GoogleResources> = {
        trampoline,
        isEmulator
    };
    const state: State = {
        resources,
        services,
        callFunnel: new Funnel(),
        project,
        functionName,
        logStitcher: new LogStitcher(),
        metrics: new GoogleMetrics(),
        options
    };

    const pricingPromise = getGoogleCloudFunctionsPricing(
        services.cloudBilling,
        region
    ).then(pricing => {
        state.pricing = pricing;
        logPricing(`Pricing: %O`, state.pricing);
    });

    if (useQueue) {
        log(`Initializing queue`);
        const googleQueueImpl = await initializeGoogleQueue(state, project, functionName);
        state.queueState = cloudqueue.initializeCloudFunctionQueue(googleQueueImpl);
    }

    const requestBody: CloudFunctions.Schema$CloudFunction = {
        name: trampoline,
        entryPoint: "trampoline",
        timeout: `${timeout}s`,
        availableMemoryMb: memorySize,
        sourceUploadUrl: uploadUrlResponse.uploadUrl,
        runtime: "nodejs8",
        ...googleCloudFunctionOptions
    };
    if (useQueue) {
        requestBody.eventTrigger = {
            eventType: "providers/cloud.pubsub/eventTypes/topic.publish",
            resource: resources.requestQueueTopic
        };
    } else {
        requestBody.httpsTrigger = {};
    }
    validateGoogleLabels(requestBody.labels);
    log(`Create function at ${location}`);
    log(`Request body: %O`, requestBody);
    try {
        log(`create function ${requestBody.name}`);
        await waitFor(
            cloudFunctions,
            cloudFunctions.projects.locations.functions.create({
                location,
                requestBody
            })
        );
    } catch (err) {
        warn(`createFunction error: ${err.stack}`);
        try {
            await deleteFunction(cloudFunctions, trampoline);
        } catch (deleteErr) {
            warn(`Could not clean up after failed create function. Possible leak.`);
            warn(deleteErr);
        }
        throw err;
    }
    if (!state.queueState) {
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
        log(`Function URL: ${url}`);
        state.url = url;
    }
    await pricingPromise;
    return state;
}

async function initializeGoogleQueue(
    state: State,
    project: string,
    functionName: string
): Promise<GoogleCloudQueueImpl> {
    const { resources, metrics } = state;
    const { pubsub } = state.services;
    resources.requestQueueTopic = `projects/${project}/topics/${functionName}-Requests`;
    const requestPromise = pubsub.projects.topics.create({
        name: resources.requestQueueTopic
    });
    resources.responseQueueTopic = `projects/${project}/topics/${functionName}-Responses`;
    const responsePromise = pubsub.projects.topics
        .create({ name: resources.responseQueueTopic })
        .then(_ => {
            resources.responseSubscription = `projects/${project}/subscriptions/${functionName}-Responses`;
            log(`Creating response queue subscription`);
            return pubsub.projects.subscriptions.create({
                name: resources.responseSubscription,
                requestBody: {
                    topic: resources.responseQueueTopic
                }
            });
        });

    await Promise.all([requestPromise, responsePromise]);
    return {
        getMessageAttribute: (message, attr) => pubsubMessageAttribute(message, attr),
        pollResponseQueueMessages: () =>
            receiveMessages(pubsub, resources.responseSubscription!, metrics),
        getMessageBody: received => getMessageBody(received),
        description: () => state.resources.responseQueueTopic!,
        publishRequestMessage: (body, attributes) =>
            publish(pubsub, resources.requestQueueTopic!, body, attributes, metrics),
        publishReceiveQueueControlMessage: type =>
            publishControlMessage(type, pubsub, resources.responseQueueTopic!),
        isControlMessage: (m, value) => pubsubMessageAttribute(m, "cloudify") === value,
        deadLetterMessages: _ => undefined
    };
}

export function exec(cmd: string) {
    const result = sys.execSync(cmd).toString();
    log(result);
    return result;
}

async function callFunctionHttps(
    url: string,
    callArgs: FunctionCall,
    costMetrics: GoogleMetrics
) {
    // only for validation
    serializeCall(callArgs);
    const rawResponse = await Axios.put<FunctionReturn>(url!, callArgs);
    const returned: FunctionReturn = rawResponse.data;
    returned.rawResponse = rawResponse;
    costMetrics.outboundBytes += computeHttpResponseBytes(rawResponse!.headers);
    return returned;
}

async function callFunction(state: State, callRequest: FunctionCall) {
    const { callFunnel } = state;
    if (state.queueState) {
        return callFunnel.push(() =>
            cloudqueue.enqueueCallRequest(
                state.queueState!,
                callRequest,
                state.resources.responseQueueTopic!
            )
        );
    } else {
        return callFunnel.pushRetry(3, async n => {
            const rv = await callFunctionHttps(
                state.url!,
                callRequest,
                state.metrics
            ).catch(err => {
                const { response } = err;
                if (response) {
                    let interpretation = "";
                    if (response.statusText === "Internal Server Error") {
                        interpretation = `(cloudify: possibly out of memory)`;
                    }
                    return Promise.reject(
                        new Error(
                            `${response.data} (${response.statusText}) ${interpretation}`
                        )
                    );
                }
                return Promise.reject(new Error(err));
            });
            if (n > 0) {
                rv.retries = n;
            }
            return rv;
        });
    }
}

type PartialState = Partial<State> & Pick<State, "services" | "resources">;

export async function cleanup(state: PartialState) {
    const {
        trampoline,
        requestQueueTopic,
        responseSubscription,
        responseQueueTopic,
        isEmulator,
        ...rest
    } = state.resources;
    const _exhaustiveCheck: Required<typeof rest> = {};
    log(`cleanup`);
    const { cloudFunctions, pubsub } = state.services;
    const cancelPromise = stop(state);
    if (trampoline) {
        await deleteFunction(cloudFunctions, trampoline).catch(warn);
    }
    if (responseSubscription) {
        await pubsub.projects.subscriptions
            .delete({
                subscription: responseSubscription
            })
            .catch(warn);
    }
    if (responseQueueTopic) {
        await pubsub.projects.topics.delete({ topic: responseQueueTopic }).catch(warn);
    }
    if (requestQueueTopic) {
        await pubsub.projects.topics.delete({ topic: requestQueueTopic }).catch(warn);
    }
    await cancelPromise;
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
    options: Options = {}
): Promise<PackerResult> {
    const { useQueue = false } = options;
    const trampolineModule = useQueue
        ? "./google-trampoline-queue"
        : "./google-trampoline-https";
    const packerOptions: PackerOptions = options;
    return packer(
        {
            trampolineModule: require.resolve(trampolineModule),
            functionModule
        },
        {
            packageJson: useQueue ? "package.json" : undefined,
            ...packerOptions
        }
    );
}

export async function cleanupResources(resourcesString: string) {
    const resources: GoogleResources = JSON.parse(resourcesString);
    const services = await initializeGoogleServices(resources.isEmulator);
    return cleanup({ resources, services });
}

export async function stop(state: Partial<State>) {
    const { callFunnel } = state;
    callFunnel &&
        callFunnel
            .pendingFutures()
            .forEach(p =>
                p.reject(new Error("Rejected promise because of queue cancellation"))
            );
    if (state.queueState) {
        await cloudqueue.stop(state.queueState);
    }
    return JSON.stringify(state.resources);
}

export async function setConcurrency(
    state: State,
    maxConcurrentExecutions: number
): Promise<void> {
    state.callFunnel.setMaxConcurrency(maxConcurrentExecutions);
}

export function getFunctionImpl() {
    return GoogleFunctionImpl;
}

function parseTimestamp(timestampStr: string | undefined) {
    return Date.parse(timestampStr || "") || 0;
}

export async function* readLogsRaw(
    logging: Logging,
    project: string,
    functionName: string,
    logStitcher: LogStitcher,
    metrics: GoogleMetrics
) {
    let pageToken: string | undefined;

    do {
        let result: AxiosResponse<Logging.Schema$ListLogEntriesResponse>;
        const filter = `resource.type="cloud_function" AND resource.labels.function_name="${functionName}" AND receiveTimestamp >= "${new Date(
            logStitcher.lastLogEventTime
        ).toISOString()}"`;
        try {
            result = await logging.entries.list({
                requestBody: {
                    resourceNames: [`projects/${project}`],
                    pageToken,
                    filter
                }
            });
        } catch (err) {
            log(err);
            await sleep(2000);
            continue;
        }
        metrics.outboundBytes += computeHttpResponseBytes(result.headers);
        pageToken = result.data.nextPageToken;
        const entries = result.data.entries || [];
        const newEntries = entries.filter(entry => !logStitcher.has(entry.insertId));
        if (newEntries.length > 0) {
            yield newEntries;
        }
        logStitcher.updateEvents(
            entries,
            e => parseTimestamp(e.receiveTimestamp),
            e => e.insertId
        );
    } while (pageToken);
}

export async function outputCurrentLogs(state: State) {
    const logStream = readLogsRaw(
        state.services.logging,
        state.project,
        state.functionName,
        state.logStitcher,
        state.metrics
    );
    for await (const entries of logStream) {
        const newEntries = entries.filter(entry => entry.textPayload);
        for (const entry of newEntries) {
            if (!state.logger) {
                return;
            }
            state.logger(
                `${new Date(parseTimestamp(entry.timestamp)).toLocaleString()} ${
                    entry.textPayload
                }`
            );
        }
    }
}

async function outputLogs(state: State) {
    while (state.logger) {
        const start = Date.now();
        await outputCurrentLogs(state);
        const delay = 1000 - (Date.now() - start);
        if (delay > 0) {
            await sleep(delay);
        }
    }
}

function setLogger(state: State, logger: Logger | undefined) {
    const prev = state.logger;
    state.logger = logger;
    if (!prev) {
        outputLogs(state);
    }
}

async function getGoogleCloudFunctionsPricing(
    cloudBilling: CloudBilling.Cloudbilling,
    region: string
): Promise<GoogleCloudPricing> {
    try {
        const services = await cloudBilling.services.list();
        async function getPricing(
            serviceName: string,
            description: string,
            conversionFactor: number = 1
        ) {
            try {
                const service = services.data.services!.find(
                    s => s.displayName === serviceName
                )!;
                const skusResponse = await cloudBilling.services.skus.list({
                    parent: service.name
                });
                const { skus = [] } = skusResponse.data;
                const matchingSkus = skus.filter(sku => sku.description === description);
                logPricing(`matching SKUs: %O`, matchingSkus);
                logPricing(
                    `  Pricing info: %O`,
                    matchingSkus.map(s => s.pricingInfo![0].pricingExpression)
                );
                const regionOrGlobalSku =
                    matchingSkus.find(sku => sku.serviceRegions![0] === region) ||
                    matchingSkus.find(sku => sku.serviceRegions![0] === "global");

                const pexp = regionOrGlobalSku!.pricingInfo![0].pricingExpression!;
                const prices = pexp.tieredRates!.map(
                    rate =>
                        Number(rate.unitPrice!.units || "0") +
                        rate.unitPrice!.nanos! / 10e9
                );
                const price =
                    Math.max(...prices) *
                    (conversionFactor / pexp.baseUnitConversionFactor!);
                logPricing(
                    `Found price for ${serviceName}, ${description}, ${region}: ${price}`
                );
                return price;
            } catch (err) {
                warn(`Could not get Google Cloud Functions pricing for '${description}'`);
                warn(err);
                return 0;
            }
        }

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
const gcfProvisonableMemoryTable = {
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
): Promise<Costs> {
    const { memorySize = defaults.memorySize } = state.options;
    const provisionableSizes = Object.keys(gcfProvisonableMemoryTable)
        .map(n => Number(n))
        .sort();
    const provisionedMb = provisionableSizes.find(size => memorySize <= size);
    logPricing(`For memory size ${memorySize}, provisioned: ${provisionedMb}`);
    if (!provisionedMb) {
        warn(
            `Could not determine provisioned memory or CPU for requested memory size ${memorySize}`
        );
    }
    const provisionedGhz = gcfProvisonableMemoryTable[provisionedMb!];
    const billedTimeStats = stats.estimatedBilledTimeMs;
    const seconds = (billedTimeStats.mean / 1000) * billedTimeStats.samples;

    const prices = state.pricing!;
    const functionCallDuration = CostMetric({
        pricing:
            prices.perGbSecond * (provisionedMb! / 1024) +
            prices.perGhzSecond * provisionedGhz,
        measured: seconds,
        unit: "GB*sec"
    });

    const functionCallRequests = CostMetric({
        pricing: prices.perInvocation,
        measured: counters.completed + counters.retries + counters.errors,
        unit: "requests"
    });

    const outboundDataTransfer = CostMetric({
        pricing: prices.perGbOutboundData,
        measured: state.metrics.outboundBytes / 2 ** 30,
        unit: "GB"
    });

    const pubsub = CostMetric({
        pricing: prices.perGbPubSub,
        measured: state.metrics.pubSubBytes / 2 ** 30,
        unit: "GB"
    });

    return {
        functionCallDuration,
        functionCallRequests,
        outboundDataTransfer,
        other: { pubsub }
    };
}
