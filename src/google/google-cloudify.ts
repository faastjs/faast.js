import Axios, { AxiosError, AxiosPromise, AxiosResponse } from "axios";
import * as sys from "child_process";
import {
    cloudbilling_v1,
    cloudfunctions_v1,
    google,
    GoogleApis,
    pubsub_v1
} from "googleapis";
import * as uuidv4 from "uuid/v4";
import {
    CloudFunctionImpl,
    CloudImpl,
    CommonOptions,
    FunctionCounters,
    FunctionStats
} from "../cloudify";
import { CostBreakdown, CostMetric } from "../cost-analyzer";
import { Funnel, MemoFunnel, RateLimitedFunnel, retry } from "../funnel";
import { log, logGc, logPricing, warn } from "../log";
import { packer, PackerOptions, PackerResult } from "../packer";
import * as cloudqueue from "../queue";
import { computeHttpResponseBytes, hasExpired, sleep } from "../shared";
import {
    FunctionCall,
    FunctionReturn,
    FunctionReturnWithMetrics,
    serializeCall
} from "../trampoline";
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
import CloudBilling = cloudbilling_v1;

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

type ReceivedMessage = PubSubApi.Schema$ReceivedMessage;

type GoogleCloudQueueState = cloudqueue.StateWithMessageType<ReceivedMessage>;
type GoogleCloudQueueImpl = cloudqueue.QueueImpl<ReceivedMessage>;

type GoogleInvocationResponse = AxiosResponse<FunctionReturn>;

export interface State {
    resources: GoogleResources;
    services: GoogleServices;
    queueState?: GoogleCloudQueueState;
    callFunnel: Funnel<GoogleInvocationResponse>;
    url?: string;
    project: string;
    functionName: string;
    pricing?: GoogleCloudPricing;
    metrics: GoogleMetrics;
    options: Options;
    gcPromise?: Promise<void>;
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
    costEstimate,
    logUrl
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
        return sleep(5 * 1000);
    }
    return sleep((retries + 1) * 100);
}

async function poll<T>({
    request,
    checkDone,
    delay = defaultPollDelay,
    maxRetries = 50
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
    return poll({
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

export async function initialize(fmodule: string, options: Options = {}): Promise<State> {
    const services = await initializeGoogleServices();
    const project = await google.auth.getProjectId();
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
    const project = await google.auth.getProjectId();
    return initializeWithApi(
        services,
        fmodule,
        {
            ...options,
            mode: "https"
        },
        project,
        true
    );
}

export const defaults: Required<Options> = {
    region: "us-central1",
    timeout: 60,
    memorySize: 256,
    mode: "https",
    gc: true,
    retentionInDays: 1,
    googleCloudFunctionOptions: {},
    addZipFile: [],
    addDirectory: [],
    packageJson: false,
    webpackOptions: {}
};

const priceRequestFunnel = new MemoFunnel<string, GoogleCloudPricing>(1);

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
        mode = defaults.mode,
        gc = defaults.gc,
        retentionInDays = defaults.retentionInDays,
        googleCloudFunctionOptions
    } = options;
    const nonce = uuidv4();
    log(`Nonce: ${nonce}`);
    const location = `projects/${project}/locations/${region}`;

    async function createCodeBundle() {
        const { archive } = await pack(serverModule, options);
        const uploadUrlResponse = await carefully(
            cloudFunctions.projects.locations.functions.generateUploadUrl({
                parent: location
            })
        );
        const uploadResult = await uploadZip(uploadUrlResponse.uploadUrl!, archive);
        log(`Upload zip file response: ${uploadResult.statusText}`);
        return uploadUrlResponse.uploadUrl;
    }

    const functionName = "cloudify-" + nonce;
    const trampoline = `projects/${project}/locations/${region}/functions/${functionName}`;

    const resources: Mutable<GoogleResources> = {
        trampoline,
        isEmulator,
        region
    };
    const state: State = {
        resources,
        services,
        callFunnel: new Funnel(),
        project,
        functionName,
        metrics: new GoogleMetrics(),
        options
    };

    if (gc) {
        logGc(`Starting garbage collector`);
        state.gcPromise = collectGarbage(services, project, retentionInDays);
    }

    const pricingPromise = priceRequestFunnel.pushMemoized(region, () =>
        getGoogleCloudFunctionsPricing(services.cloudBilling, region)
    );

    if (mode === "queue") {
        log(`Initializing queue`);
        const googleQueueImpl = await initializeGoogleQueue(state, project, functionName);
        state.queueState = cloudqueue.initializeCloudFunctionQueue(googleQueueImpl);
    }

    const sourceUploadUrl = await createCodeBundle();

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
        log(`delete function ${trampoline}`);
        await deleteFunction(cloudFunctions, trampoline).catch();
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

function getRequestQueueTopic(project: string, functionName: string) {
    return `projects/${project}/topics/${functionName}-Requests`;
}

function getResponseQueueTopic(project: string, functionName: string) {
    return `projects/${project}/topics/${functionName}-Responses`;
}

function getResponseSubscription(project: string, functionName: string) {
    return `projects/${project}/subscriptions/${functionName}-Responses`;
}

async function initializeGoogleQueue(
    state: State,
    project: string,
    functionName: string
): Promise<GoogleCloudQueueImpl> {
    const { resources, metrics } = state;
    const { pubsub } = state.services;
    resources.requestQueueTopic = getRequestQueueTopic(project, functionName);
    const requestPromise = pubsub.projects.topics.create({
        name: resources.requestQueueTopic
    });
    resources.responseQueueTopic = getResponseQueueTopic(project, functionName);
    const responsePromise = pubsub.projects.topics
        .create({ name: resources.responseQueueTopic })
        .then(_ => {
            resources.responseSubscription = getResponseSubscription(
                project,
                functionName
            );
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
        getMessageSentTimestamp: message => parseTimestamp(message.message!.publishTime!),
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
    metrics: GoogleMetrics,
    callFunnel: Funnel<GoogleInvocationResponse>,
    shouldRetry: (err: Error, retries: number) => boolean
): Promise<FunctionReturnWithMetrics> {
    // only for validation
    serializeCall(callArgs);

    let localRequestSentTime!: number;

    const isTransientFailure = (err: AxiosError, n: number) => {
        if (err.response) {
            const { status } = err.response;
            return status !== 503 && status !== 408 && shouldRetry(err, n);
        }
        return shouldRetry(err, n);
    };

    try {
        const rawResponse = await callFunnel.pushRetry(isTransientFailure, () => {
            localRequestSentTime = Date.now();
            return Axios.put<FunctionReturn>(url!, callArgs, {});
        });
        const localEndTime = Date.now();
        const returned: FunctionReturn = rawResponse.data;
        metrics.outboundBytes += computeHttpResponseBytes(rawResponse!.headers);
        return {
            returned,
            rawResponse,
            localRequestSentTime,
            remoteResponseSentTime: returned.remoteExecutionEndTime!,
            localEndTime
        };
    } catch (err) {
        const { response } = err;
        let error = err;
        if (response) {
            const interpretation =
                response && response.status === 503
                    ? " (cloudify: possibly out of memory error)"
                    : "";
            error = new Error(
                `${response.status} ${response.statusText} ${
                    response.data
                }${interpretation}`
            );
        }
        return {
            returned: {
                type: "error",
                CallId: callArgs.CallId,
                value: error
            },
            localEndTime: Date.now(),
            localRequestSentTime,
            rawResponse: err
        };
    }
}

async function callFunction(
    state: State,
    callRequest: FunctionCall,
    shouldRetry: (err: Error, retries: number) => boolean
) {
    if (state.queueState) {
        const {
            queueState,
            resources: { responseQueueTopic }
        } = state;
        return cloudqueue.enqueueCallRequest(
            queueState!,
            callRequest,
            responseQueueTopic!
        );
    } else {
        const { url, metrics, callFunnel } = state;
        return callFunctionHttps(url!, callRequest, metrics, callFunnel, shouldRetry);
    }
}

type PartialState = Partial<State> & Pick<State, "services" | "resources">;

async function deleteResources(
    services: GoogleServices,
    resources: GoogleResources,
    output: (msg: string) => void = log
) {
    const {
        trampoline,
        requestQueueTopic,
        responseSubscription,
        responseQueueTopic,
        isEmulator,
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

export async function cleanup(state: PartialState) {
    log(`cleanup`);
    await stop(state);
    await deleteResources(state.services, state.resources);
}

let garbageCollectorRunning = false;

async function collectGarbage(
    services: GoogleServices,
    project: string,
    retentionInDays: number
) {
    if (garbageCollectorRunning) {
        return;
    }
    garbageCollectorRunning = true;
    try {
        const { cloudFunctions } = services;

        let pageToken: string | undefined;

        const gcFunnel = new RateLimitedFunnel({
            maxConcurrency: 5,
            targetRequestsPerSecond: 5,
            maxBurst: 2
        });

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
                .filter(fn => fn.name!.match(`/functions/cloudify-[a-f0-9-]+$`));

            garbageFunctions.forEach(fn =>
                gcFunnel.push(() => deleteFunctionResources(services, fn))
            );
        } while (pageToken);

        await gcFunnel.all();
    } finally {
        garbageCollectorRunning = false;
    }
}

function parseFunctionName(path: string) {
    const match = path.match(/^projects\/(.*)\/locations\/(.*)\/functions\/(.*)$/);
    return match && { project: match[1], region: match[2], name: match[3] };
}

async function deleteFunctionResources(
    services: GoogleServices,
    fn: CloudFunctions.Schema$CloudFunction
) {
    const { region, name, project } = parseFunctionName(fn.name!)!;

    const resources: GoogleResources = {
        isEmulator: false,
        region,
        trampoline: fn.name!,
        requestQueueTopic: getRequestQueueTopic(project, name),
        responseQueueTopic: getResponseQueueTopic(project, name),
        responseSubscription: getResponseSubscription(project, name)
    };

    await deleteResources(services, resources, logGc);
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
    const { mode = "https" } = options;
    const trampolineModule =
        mode === "queue" ? "./google-trampoline-queue" : "./google-trampoline-https";
    const packerOptions: PackerOptions = options;
    return packer(
        {
            trampolineModule: require.resolve(trampolineModule),
            functionModule
        },
        {
            packageJson: mode === "queue" ? "package.json" : undefined,
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
    callFunnel && callFunnel.clear();
    if (state.queueState) {
        await cloudqueue.stop(state.queueState);
    }
    if (state.gcPromise) {
        log(`Waiting for garbage collection...`);
        await state.gcPromise;
        log(`Garbage collection done.`);
    }
    return JSON.stringify(state.resources);
}

export async function setConcurrency(state: State, maxConcurrentExecutions: number) {
    state.callFunnel.setMaxConcurrency(maxConcurrentExecutions);
}

export function getFunctionImpl() {
    return GoogleFunctionImpl;
}

function parseTimestamp(timestampStr: string | undefined) {
    return Date.parse(timestampStr || "") || 0;
}

import * as util from "util";

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
                logPricing(
                    `matching SKUs: ${util.inspect(matchingSkus, { depth: null })}`
                );

                const regionOrGlobalSku =
                    matchingSkus.find(sku => sku.serviceRegions![0] === region) ||
                    matchingSkus.find(sku => sku.serviceRegions![0] === "global");

                const pexp = regionOrGlobalSku!.pricingInfo![0].pricingExpression!;
                const prices = pexp.tieredRates!.map(
                    rate =>
                        Number(rate.unitPrice!.units || "0") +
                        rate.unitPrice!.nanos! / 1e9
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
): Promise<CostBreakdown> {
    const costs = new CostBreakdown();
    const { memorySize = defaults.memorySize } = state.options;
    const provisionableSizes = Object.keys(gcfProvisonableMemoryTable)
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
    const prices = await priceRequestFunnel.pushMemoized(region, () =>
        getGoogleCloudFunctionsPricing(state.services.cloudBilling, region)
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
        measured: counters.completed + counters.retries + counters.errors,
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
