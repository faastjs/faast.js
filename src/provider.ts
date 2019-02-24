import * as webpack from "webpack";
import { CostBreakdown } from "./cost";
import { PackerResult } from "./packer";
import { Statistics } from "./shared";
import { CpuMeasurement, FunctionReturn, WrapperOptions } from "./wrapper";

export const CALLID_ATTR = "__faast_callid__";
export const KIND_ATTR = "__faast_kind__";

/**
 * Options common across all faast.js providers.
 * @public
 */
export interface CommonOptions {
    addDirectory?: string | string[];
    addZipFile?: string | string[];
    childProcess?: boolean;
    concurrency?: number;
    gc?: boolean;
    maxRetries?: number;
    memorySize?: number;
    mode?: "https" | "queue" | "auto";
    packageJson?: string | object | false;
    retentionInDays?: number;
    speculativeRetryThreshold?: number;
    timeout?: number;
    webpackOptions?: webpack.Configuration;
}

export const CommonOptionDefaults: Required<CommonOptions> = {
    addDirectory: [],
    addZipFile: [],
    childProcess: true,
    concurrency: 100,
    gc: true,
    maxRetries: 2,
    memorySize: 1024,
    mode: "auto",
    packageJson: false,
    retentionInDays: 1,
    speculativeRetryThreshold: 3,
    timeout: 60,
    webpackOptions: {}
};

/**
 * @public
 */
export interface CleanupOptions {
    deleteResources?: boolean;
}

export const CleanupOptionDefaults: Required<CleanupOptions> = {
    deleteResources: true
};

/**
 * @public
 */
export class FunctionCounters {
    invocations = 0;
    completed = 0;
    retries = 0;
    errors = 0;

    toString() {
        return `completed: ${this.completed}, retries: ${this.retries}, errors: ${
            this.errors
        }`;
    }
}

/**
 * @public
 */
export class FunctionStats {
    localStartLatency = new Statistics();
    remoteStartLatency = new Statistics();
    executionTime = new Statistics();
    sendResponseLatency = new Statistics();
    returnLatency = new Statistics();
    estimatedBilledTime = new Statistics();

    toString() {
        return Object.keys(this)
            .map(key => `${key}: ${(<any>this)[key]}`)
            .join(", ");
    }
}

export class FunctionExecutionMetrics {
    secondMetrics: Statistics[] = [];
}

export type StringifiedFunctionCall = string;
export type StringifiedFunctionReturn = string;

export type CallId = string;

export interface Invocation {
    callId: CallId;
    body: StringifiedFunctionCall;
}

export interface ResponseMessage {
    kind: "response";
    callId: CallId;
    body: StringifiedFunctionReturn | FunctionReturn;
    rawResponse?: any;
    timestamp?: number; // timestamp when response message was sent according to cloud service, this is optional and used to provide more accurate metrics.
}

export interface DeadLetterMessage {
    kind: "deadletter";
    callId: CallId;
    message?: string;
}

export interface StopQueueMessage {
    kind: "stopqueue";
}

export interface FunctionStartedMessage {
    kind: "functionstarted";
    callId: CallId;
}

export interface CpuMetricsMessage {
    kind: "cpumetrics";
    callId: CallId;
    metrics: CpuMeasurement;
}

export interface PollResult {
    Messages: ReceivableMessage[];
    isFullMessageBatch?: boolean;
}

export type SendableMessage = StopQueueMessage;

export type ReceivableMessage =
    | DeadLetterMessage
    | ResponseMessage
    | FunctionStartedMessage
    | StopQueueMessage
    | CpuMetricsMessage;

export type Message = SendableMessage | ReceivableMessage;
export type SendableKind = SendableMessage["kind"];
export type ReceivableKind = ReceivableMessage["kind"];
export type Kind = Message["kind"];
export type UUID = string;

export interface CloudFunctionImpl<O extends CommonOptions, S> {
    name: string;
    defaults: Required<O>;

    initialize(serverModule: string, nonce: UUID, options: Required<O>): Promise<S>;

    pack(
        functionModule: string,
        options: CommonOptions,
        wrapperOptions: WrapperOptions
    ): Promise<PackerResult>;

    costEstimate?: (
        state: S,
        counters: FunctionCounters,
        stats: FunctionStats
    ) => Promise<CostBreakdown>;

    cleanup(state: S, options: Required<CleanupOptions>): Promise<void>;
    logUrl(state: S): string;
    invoke(
        state: S,
        request: Invocation,
        cancel: Promise<void>
    ): Promise<ResponseMessage | void>;
    publish(state: S, message: SendableMessage): Promise<void>;
    poll(state: S, cancel: Promise<void>): Promise<PollResult>;
    responseQueueId(state: S): string | void;
}
