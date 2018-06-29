import Axios, { AxiosPromise, AxiosResponse } from "axios";
import * as sys from "child_process";
import { google, cloudfunctions_v1beta2, pubsub_v1 } from "googleapis";
import humanStringify from "human-stringify";
import { Readable } from "stream";
import * as uuidv4 from "uuid/v4";
import {
    AnyFunction,
    Response,
    ResponsifiedFunction,
    CreateFunctionOptions
} from "../cloudify";
import { log } from "../log";
import { PackerResult, packer } from "../packer";
import { FunctionCall, FunctionReturn, sleep } from "../shared";

import CloudFunctionsApi = cloudfunctions_v1beta2;
import PubSubApi = pubsub_v1;
import { Funnel, AutoFunnel, Deferred } from "../funnel";
import * as cloudqueue from "../queue";
import { Mutable } from "../type-helpers";

export interface Options {
    region?: string;
    timeoutSec?: number;
    memorySize?: number;
    useQueue?: boolean;
    googleCloudFunctionOptions?: CloudFunctionsApi.Schema$CloudFunction;
}

export interface GoogleResources {
    trampoline: string;
    project: string;
    isEmulator: boolean;
    url: string;
    requestQueueTopic?: string;
    responseQueueTopic?: string;
    responseSubscription?: string;
}

export interface GoogleServices {
    readonly cloudFunctionsApi: CloudFunctionsApi.Cloudfunctions;
    readonly pubsub: PubSubApi.Pubsub;
}

export const name: string = "google";

type ReceivedMessage = PubSubApi.Schema$ReceivedMessage;

type GoogleCloudQueueState = cloudqueue.StateWithMessageType<ReceivedMessage>;
type GoogleCloudQueueImpl = cloudqueue.Impl<ReceivedMessage>;

export type State = {
    resources: GoogleResources;
    services: GoogleServices;
    queueState?: GoogleCloudQueueState;
    callFunnel: Funnel;
};

export async function initializeGoogleAPIs() {
    const auth = await google.auth.getClient({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });

    const project = await google.auth.getDefaultProjectId();
    google.options({ auth });
    return google;
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
        log(`not done, retrying...`);
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
    api: CloudFunctionsApi.Cloudfunctions,
    response: AxiosPromise<CloudFunctionsApi.Schema$Operation>
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

async function deleteFunction(api: CloudFunctionsApi.Cloudfunctions, path: string) {
    log(`delete function ${path}`);
    const response = await waitFor(
        api,
        api.projects.locations.functions.delete({
            name: path
        })
    );
}

export async function initialize(fmodule: string, options: Options = {}): Promise<State> {
    const google = await initializeGoogleAPIs();
    const project = await google.auth.getDefaultProjectId();
    const cloudFunctionsApi = google.cloudfunctions("v1beta2");
    return initializeWithApi(fmodule, options, cloudFunctionsApi, project, false);
}

async function getEmulator(): Promise<CloudFunctionsApi.Cloudfunctions> {
    exec("functions start");
    const output = exec(`functions status`);
    const rest = output.match(/REST Service\s+│\s+(http:\/\/localhost:\S+)/);
    if (!rest || !rest[1]) {
        throw new Error("Could not find cloud functions service REST url");
    }
    const url = rest[1];

    // Adjust localhost:8008 to match the host and port where your Emulator is running
    const DISCOVERY_URL = `${url}$discovery/rest?version=v1beta2`;
    log(`DISCOVERY_URL: ${DISCOVERY_URL}`);
    const emulator = await google.discoverAPI(DISCOVERY_URL);
    return emulator as any;
}

export async function initializeEmulator(fmodule: string, options: Options = {}) {
    const google = await initializeGoogleAPIs();
    const project = await google.auth.getDefaultProjectId();
    const emulator = await getEmulator();
    return initializeWithApi(
        fmodule,
        { ...options, useQueue: false },
        emulator,
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
    serverModule: string,
    options: Options,
    cloudFunctionsApi: CloudFunctionsApi.Cloudfunctions,
    project: string,
    isEmulator: boolean
): Promise<State> {
    log(`Create cloud function`);
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
        cloudFunctionsApi.projects.locations.functions.generateUploadUrl({
            parent: location
        })
    );
    const uploadResult = await uploadZip(uploadUrlResponse.uploadUrl!, archive);
    log(`Upload zip file response: ${uploadResult.statusText}`);
    const functionName = "cloudify-" + nonce;
    const trampoline = `projects/${project}/locations/${region}/functions/${functionName}`;
    const requestBody: CloudFunctionsApi.Schema$CloudFunction = {
        name: trampoline,
        entryPoint: "trampoline",
        timeout: `${timeoutSec}s`,
        availableMemoryMb: memorySize,
        httpsTrigger: {},
        sourceUploadUrl: uploadUrlResponse.uploadUrl,
        ...googleCloudFunctionOptions,
        ...rest
    };
    validateGoogleLabels(requestBody.labels);
    const existingFunc = await quietly(
        cloudFunctionsApi.projects.locations.functions.get({ name })
    );

    if (existingFunc) {
        throw new Error(`Trampoline name hash collision`);
    }
    log(`Create function at ${location}`);
    log(humanStringify(requestBody));
    try {
        log(`create function ${requestBody.name}`);
        await waitFor(
            cloudFunctionsApi,
            cloudFunctionsApi.projects.locations.functions.create({
                location,
                requestBody
            })
        );
    } catch (err) {
        log(`createFunction error: ${err.stack}`);
        try {
            await deleteFunction(cloudFunctionsApi, trampoline);
        } catch (deleteErr) {
            log(`Could not clean up after failed create function. Possible leak.`);
            log(deleteErr);
        }
        throw err;
    }
    const func = await carefully(
        cloudFunctionsApi.projects.locations.functions.get({ name: trampoline })
    );
    if (!func || !func.httpsTrigger) {
        throw new Error("Could not get http trigger url");
    }
    const { url } = func.httpsTrigger!;
    if (!url) {
        throw new Error("Could not get http trigger url");
    }
    log(`Function URL: ${url}`);
    let pubsub = google.pubsub("v1");
    let resources: Mutable<GoogleResources> = {
        trampoline,
        project,
        isEmulator,
        url
    };
    let state: State = {
        resources,
        services: { cloudFunctionsApi, pubsub },
        callFunnel: new Funnel()
    };
    if (useQueue) {
        const googleQueueImpl = await initializeGoogleQueue(state, project, functionName);
        state.queueState = cloudqueue.initializeCloudFunctionQueue(googleQueueImpl);
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

    return {
        isStopQueueMessage: message =>
            pubsubMessageAttribute(message, "cloudify") === "stop",
        isStartedFunctionCallMessage: message =>
            pubsubMessageAttribute(message, "cloudify") === "started",
        receiveMessages: () => receiveMessages(state),
        getMessageBody: received => (received.message && received.message.data) || "",
        getCallId: message => pubsubMessageAttribute(message, "CallId") || "",
        publish: call => publish(state, call),
        sendStopQueueMessage: () => sendStopQueueMessage(state),
        description: () => state.resources.responseQueueTopic!
    };
}

function pubsubMessageAttribute({ message }: ReceivedMessage, attr: string) {
    return message && message.attributes && (message.attributes[attr] as string);
}

async function receiveMessages(state: State) {
    const { pubsub } = state.services;
    const { responseSubscription } = state.resources;
    const response = await pubsub.projects.subscriptions.pull({
        subscription: responseSubscription,
        // XXX maxMessages?
        requestBody: { returnImmediately: false, maxMessages: 10 }
    });
    const messages = response.data.receivedMessages || [];
    if (messages.length > 0) {
        carefully(
            pubsub.projects.subscriptions.acknowledge({
                subscription: responseSubscription,
                requestBody: {
                    ackIds: messages.map(m => m.ackId || "").filter(m => m != "")
                }
            })
        );
    }
    return messages;
}

async function publish(state: State, call: FunctionCall) {
    const { pubsub } = state.services;
    const { requestQueueTopic } = state.resources!;
    carefully(
        pubsub.projects.topics.publish({
            topic: requestQueueTopic,
            requestBody: { messages: [{ data: JSON.stringify(call) }] }
        })
    );
}

export function createControlMessage(
    attrs: cloudqueue.Attributes
): PubSubApi.Schema$PubsubMessage {
    const attributes: object = {};
    Object.keys(attrs).forEach(key => {
        attributes[key] = { DataType: "String", StringValue: attrs[key] };
    });
    return { attributes };
}

async function sendStopQueueMessage(state: State) {
    const { pubsub } = state.services;
    const { responseQueueTopic } = state.resources;
    return pubsub.projects.topics.publish({
        topic: responseQueueTopic,
        requestBody: { messages: [createControlMessage({ cloudify: "stop" })] }
    });
}

export function exec(cmd: string) {
    const result = sys.execSync(cmd).toString();
    console.log(result);
    return result;
}

export function cloudifyWithResponse<F extends AnyFunction>(
    state: State,
    fn: F
): ResponsifiedFunction<F> {
    const { isEmulator, trampoline, url } = state.resources;
    const promisifedFunc = async (...args: any[]) => {
        const CallId = uuidv4();
        let callArgs: FunctionCall = {
            name: fn.name,
            args,
            CallId
        };
        const data = JSON.stringify(callArgs);
        log(`Calling cloud function "${fn.name}" with args: ${data}`, "");
        const rawResponse = await Axios.put<FunctionReturn>(url, callArgs);
        let error: Error | undefined;
        if (rawResponse.status < 200 || rawResponse.status >= 300) {
            error = new Error(rawResponse.statusText);
        }
        log(`  returned: ${humanStringify(rawResponse.data)}`);
        let returned: FunctionReturn = rawResponse.data;
        if (returned && returned.type === "error") {
            const errValue = returned.value;
            error = new Error(errValue.message);
            error.name = errValue.name;
            error.stack = errValue.stack;
        }
        const value = returned && returned.value;
        const rv: Response<ReturnType<F>> = { error, value, rawResponse };
        return rv;
    };
    return promisifedFunc as any;
}

export async function cleanup(state: State) {
    await deleteFunction(
        state.services.cloudFunctionsApi,
        state.resources.trampoline
    ).catch(_ => {});
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
        functionModule
    });
}

export function getResourceList(state: State) {
    return JSON.stringify(state.resources);
}

export async function cleanupResources(resources: string) {
    const { trampoline, project, isEmulator }: GoogleResources = JSON.parse(resources);
    const google = await initializeGoogleAPIs();
    let cloudFunctionsApi: CloudFunctionsApi.Cloudfunctions;
    if (trampoline) {
        log(`Cleaning up cloudify trampoline function: ${trampoline}`);
        if (isEmulator) {
            log(`Using emulator`);
            cloudFunctionsApi = await getEmulator();
        } else {
            cloudFunctionsApi = google.cloudfunctions("v1beta2");
        }
        await deleteFunction(cloudFunctionsApi, trampoline).catch(_ => {});
    }
}

/// XXX All the below are unimplemented
export async function cancelWithoutCleanup(_state: State) {
    throw new Error("cancelWithoutCleanup not implemented");
}

export async function setConcurrency(
    state: State,
    maxConcurrentExecutions: number
): Promise<void> {
    const { pubsub } = state.services;
    xxx;
}

export function translateOptions({
    timeout,
    memorySize,
    cloudSpecific
}: CreateFunctionOptions<Options> = {}): Options {
    return {
        timeoutSec: timeout,
        memorySize,
        ...cloudSpecific
    };
}
export function getFunctionImpl() {
    return exports;
}
