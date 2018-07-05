import Axios, { AxiosPromise, AxiosResponse } from "axios";
import * as sys from "child_process";
import { cloudfunctions_v1beta2, google, GoogleApis, pubsub_v1 } from "googleapis";
import humanStringify from "human-stringify";
import { Readable } from "stream";
import * as uuidv4 from "uuid/v4";
import { CreateFunctionOptions, ResponsifiedFunction } from "../cloudify";
import { Funnel } from "../funnel";
import { log } from "../log";
import { packer, PackerResult } from "../packer";
import * as cloudqueue from "../queue";
import { FunctionCall, FunctionReturn, processResponse, sleep } from "../shared";
import { AnyFunction, Mutable } from "../type-helpers";
import {
    getMessageBody,
    publish,
    pubsubMessageAttribute,
    receiveMessages
} from "./google-queue";
import CloudFunctions = cloudfunctions_v1beta2;
import PubSubApi = pubsub_v1;

export interface Options {
    region?: string;
    timeoutSec?: number;
    memorySize?: number;
    useQueue?: boolean;
    googleCloudFunctionOptions?: CloudFunctions.Schema$CloudFunction;
}

export interface GoogleResources {
    trampoline: string;
    requestQueueTopic?: string;
    responseQueueTopic?: string;
    responseSubscription?: string;
    isEmulator: boolean;
}

export interface GoogleServices {
    readonly cloudFunctions: CloudFunctions.Cloudfunctions;
    readonly pubsub: PubSubApi.Pubsub;
    readonly google: GoogleApis;
}

export const name: string = "google";

type ReceivedMessage = PubSubApi.Schema$ReceivedMessage;

type GoogleCloudQueueState = cloudqueue.StateWithMessageType<ReceivedMessage>;
type GoogleCloudQueueImpl = cloudqueue.QueueImpl<ReceivedMessage>;
type GoogleCloudFunctionResponse = AxiosResponse<FunctionReturn>;

export type State = {
    resources: GoogleResources;
    services: GoogleServices;
    queueState?: GoogleCloudQueueState;
    callFunnel: Funnel<GoogleCloudFunctionResponse>;
    url?: string;
};

export async function initializeGoogleServices(
    useEmulator: boolean
): Promise<GoogleServices> {
    const auth = await google.auth.getClient({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });
    google.options({ auth });
    return {
        cloudFunctions: useEmulator
            ? await getEmulator()
            : google.cloudfunctions("v1beta2"),
        pubsub: google.pubsub("v1"),
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
    maxRetries = 20
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
        let result = await promise;
        return result.data;
    } catch (err) {
        log(err);
        throw err;
    }
}

async function quietly<T>(promise: AxiosPromise<T>) {
    let result = await promise.catch(_ => {});
    return result && result.data;
}

async function waitFor(
    api: CloudFunctions.Cloudfunctions,
    response: AxiosPromise<CloudFunctions.Schema$Operation>
) {
    const name = (await response).data.name!;
    return poll({
        request: () => carefully(api.operations.get({ name })),
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
    const response = await waitFor(
        api,
        api.projects.locations.functions.delete({
            name: path
        })
    );
}

export async function initialize(fmodule: string, options: Options = {}): Promise<State> {
    const services = await initializeGoogleServices(false);
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
    const DISCOVERY_URL = `${url}$discovery/rest?version=v1beta2`;
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
        { ...options, useQueue: false },
        project,
        true
    );
}

export const defaults: Required<Options> = {
    region: "us-central1",
    timeoutSec: 60,
    memorySize: 256,
    useQueue: true,
    googleCloudFunctionOptions: {}
};

async function initializeWithApi(
    services: GoogleServices,
    serverModule: string,
    options: Options,
    project: string,
    isEmulator: boolean
): Promise<State> {
    log(`Create cloud function`);
    const { cloudFunctions, pubsub } = services;
    const { archive } = await pack(serverModule);
    const nonce = uuidv4();
    log(`Nonce: ${nonce}`);
    const {
        region = defaults.region,
        timeoutSec = defaults.timeoutSec,
        memorySize = defaults.memorySize,
        useQueue = defaults.useQueue,
        googleCloudFunctionOptions,
        ...rest
    } = options;
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

    let resources: Mutable<GoogleResources> = { trampoline, isEmulator };
    let state: State = { resources, services, callFunnel: new Funnel() };
    if (useQueue) {
        const googleQueueImpl = await initializeGoogleQueue(state, project, functionName);
        state.queueState = cloudqueue.initializeCloudFunctionQueue(googleQueueImpl);
    }

    const requestBody: CloudFunctions.Schema$CloudFunction = {
        name: trampoline,
        entryPoint: useQueue ? "pubsubTrampoline" : "trampoline",
        timeout: `${timeoutSec}s`,
        availableMemoryMb: memorySize,
        sourceUploadUrl: uploadUrlResponse.uploadUrl,
        ...googleCloudFunctionOptions,
        ...rest
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
    const existingFunc = await quietly(
        cloudFunctions.projects.locations.functions.get({ name })
    );

    if (existingFunc) {
        throw new Error(`Trampoline name hash collision`);
    }
    log(`Create function at ${location}`);
    log(humanStringify(requestBody));
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
        log(`createFunction error: ${err.stack}`);
        try {
            await deleteFunction(cloudFunctions, trampoline);
        } catch (deleteErr) {
            log(`Could not clean up after failed create function. Possible leak.`);
            log(deleteErr);
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
    return state;
}

async function initializeGoogleQueue(
    state: State,
    project: string,
    functionName: string
): Promise<GoogleCloudQueueImpl> {
    const { resources } = state;
    const { pubsub } = state.services;
    resources.requestQueueTopic = `projects/${project}/topics/${functionName}-Requests`;
    await pubsub.projects.topics.create({ name: resources.requestQueueTopic });
    resources.responseQueueTopic = `projects/${project}/topics/${functionName}-Responses`;
    await pubsub.projects.topics.create({ name: resources.responseQueueTopic });

    resources.responseSubscription = `projects/${project}/subscriptions/${functionName}-Responses`;
    await pubsub.projects.subscriptions.create({
        name: resources.responseSubscription,
        requestBody: {
            topic: resources.responseQueueTopic
        }
    });

    return {
        getMessageAttribute: (message, attr) => pubsubMessageAttribute(message, attr),
        receiveMessages: () => receiveMessages(pubsub, resources.responseSubscription!),
        getMessageBody: received => getMessageBody(received),
        description: () => state.resources.responseQueueTopic!,
        publishMessage: (body, attributes) =>
            publish(pubsub, resources.requestQueueTopic!, body, attributes),
        publishControlMessage: (type, attr) =>
            publish(pubsub, resources.responseQueueTopic!, "empty", {
                ...attr,
                cloudify: type
            }),
        isControlMessage: (message, type) =>
            pubsubMessageAttribute(message, "cloudify") === type
    };
}

export function exec(cmd: string) {
    const result = sys.execSync(cmd).toString();
    console.log(result);
    return result;
}

async function callFunctionWithQueue(
    queueState: GoogleCloudQueueState,
    callArgs: FunctionCall
) {
    const responsePromise = await cloudqueue.enqueueCallRequest(
        queueState,
        JSON.stringify(callArgs),
        callArgs.CallId
    );
    const { returned, rawResponse } = await responsePromise;
    return processResponse(undefined, returned, rawResponse);
}

async function callFunction(
    url: string,
    callArgs: FunctionCall,
    callFunnel: Funnel<GoogleCloudFunctionResponse>
) {
    let error: Error | undefined;
    const rawResponse = await callFunnel.pushRetry(3, () =>
        Axios.put<FunctionReturn>(url!, callArgs).catch(err =>
            Promise.reject((err.response && err.response.data) || err)
        )
    );
    log(`  returned: ${humanStringify(rawResponse.data)}`);
    return processResponse(error, rawResponse.data, rawResponse);
}

export function cloudifyWithResponse<F extends AnyFunction>(
    state: State,
    fn: F
): ResponsifiedFunction<F> {
    const promisifedFunc = async (...args: any[]) => {
        const CallId = uuidv4();
        let callArgs: FunctionCall = {
            name: fn.name,
            args,
            CallId,
            ResponseQueueId: state.resources.responseQueueTopic
        };
        const data = JSON.stringify(callArgs);
        log(`Calling cloud function "${fn.name}" with args: ${data}`, "");
        if (state.queueState) {
            return callFunctionWithQueue(state.queueState, callArgs);
        } else {
            return callFunction(state.url!, callArgs, state.callFunnel);
        }
    };
    return promisifedFunc as any;
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
    const cancelPromise = cancelWithoutCleanup(state);
    if (trampoline) {
        await deleteFunction(cloudFunctions, trampoline).catch(_ => {});
    }
    if (responseSubscription) {
        await pubsub.projects.subscriptions.delete({
            subscription: responseSubscription
        });
    }
    if (responseQueueTopic) {
        await pubsub.projects.topics.delete({ topic: responseQueueTopic });
    }
    if (requestQueueTopic) {
        await pubsub.projects.topics.delete({ topic: requestQueueTopic });
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
function validateGoogleLabels(labels: object | undefined) {
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

async function uploadZip(url: string, zipStream: Readable) {
    return await Axios.put(url, zipStream, {
        headers: {
            "content-type": "application/zip",
            "x-goog-content-length-range": "0,104857600"
        }
    });
}

export async function pack(functionModule: string): Promise<PackerResult> {
    return packer({
        trampolineModule: require.resolve("./google-trampoline"),
        functionModule,
        packageBundling: "usePackageJson"
    });
}

export function getResourceList(state: State) {
    return JSON.stringify(state.resources);
}

export async function cleanupResources(resourcesString: string) {
    const resources: GoogleResources = JSON.parse(resourcesString);
    const services = await initializeGoogleServices(resources.isEmulator);
    return cleanup({ resources, services });
}

export async function cancelWithoutCleanup(state: Partial<State>) {
    log(`cancelWithoutCleanup`);
    const { callFunnel } = state;
    callFunnel && callFunnel.clear();
    if (state.queueState) {
        await cloudqueue.stop(state.queueState);
    }
}

export async function setConcurrency(
    state: State,
    maxConcurrentExecutions: number
): Promise<void> {
    state.callFunnel.setMaxConcurrency(maxConcurrentExecutions);
}

export function translateOptions({
    timeout,
    memorySize,
    cloudSpecific,
    useQueue,
    ...rest
}: CreateFunctionOptions<Options> = {}): Options {
    const _exhaustiveCheck: Required<typeof rest> = {};
    return {
        timeoutSec: timeout,
        memorySize,
        useQueue,
        ...cloudSpecific
    };
}
export function getFunctionImpl() {
    return exports;
}
