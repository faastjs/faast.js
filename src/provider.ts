import { CostBreakdown } from "./cost";
import { Statistics } from "./shared";
import { FunctionReturn } from "./wrapper";
import { PackerResult } from "./packer";

export const CALLID_ATTR = "__faast_callid__";
export const KIND_ATTR = "__faast_kind__";

import * as webpack from "webpack";

export interface PackerOptions {
    addDirectory?: string | string[];
    addZipFile?: string | string[];
    packageJson?: string | object | false;
    webpackOptions?: webpack.Configuration;
}

export const PackerOptionDefaults: Required<PackerOptions> = {
    addDirectory: [],
    addZipFile: [],
    packageJson: false,
    webpackOptions: {}
};

export interface CommonOptions extends PackerOptions {
    childProcess?: boolean;
    concurrency?: number;
    gc?: boolean;
    maxRetries?: number;
    memorySize?: number;
    mode?: "https" | "queue" | "auto";
    retentionInDays?: number;
    speculativeRetryThreshold?: number;
    timeout?: number;
}

export const CommonOptionDefaults: Required<CommonOptions> = {
    ...PackerOptionDefaults,
    childProcess: false,
    concurrency: 100,
    gc: true,
    maxRetries: 2,
    memorySize: 1024,
    mode: "auto",
    retentionInDays: 1,
    speculativeRetryThreshold: 3,
    timeout: 60
};

export interface CleanupOptions {
    deleteResources?: boolean;
}

export const CleanupOptionDefaults: Required<CleanupOptions> = {
    deleteResources: true
};

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

export class FunctionStats {
    localStartLatency = new Statistics();
    remoteStartLatency = new Statistics();
    executionLatency = new Statistics();
    sendResponseLatency = new Statistics();
    returnLatency = new Statistics();
    estimatedBilledTime = new Statistics();

    toString() {
        return Object.keys(this)
            .map(key => `${key}: ${(<any>this)[key]}`)
            .join(", ");
    }
}

export interface Invocation {
    CallId: string;
    body: string;
}

export interface ResponseMessage {
    kind: "response";
    CallId: string;
    body: string | FunctionReturn;
}

export interface ResponseMessageReceived extends ResponseMessage {
    rawResponse: any;
    timestamp: number; // timestamp when response message was sent according to cloud service, this is optional and used to provide more accurate metrics.
}

export interface DeadLetterMessage {
    kind: "deadletter";
    CallId: string;
    // callRequest?: FunctionCall;
    message?: string;
}

export interface StopQueueMessage {
    kind: "stopqueue";
}

export interface FunctionStartedMessage {
    kind: "functionstarted";
    CallId: string;
}

export interface PollResult {
    Messages: ReceivableMessage[];
    isFullMessageBatch?: boolean;
}

export type SendableMessage = ResponseMessage | FunctionStartedMessage | StopQueueMessage;

export type ReceivableMessage =
    | DeadLetterMessage
    | ResponseMessageReceived
    | FunctionStartedMessage
    | StopQueueMessage;

export type SendableKind = SendableMessage["kind"];
export type ReceivableKind = ReceivableMessage["kind"];
export type Kind = ReceivableKind | SendableKind;

export interface CloudFunctionImpl<O extends CommonOptions, S> {
    name: string;
    defaults: Required<O>;

    initialize(
        serverModule: string,
        functionId: string,
        options: Required<O>
    ): Promise<S>;

    pack(functionModule: string, options?: PackerOptions): Promise<PackerResult>;

    costEstimate?: (
        state: S,
        counters: FunctionCounters,
        stats: FunctionStats
    ) => Promise<CostBreakdown>;

    cleanup(state: S, options: Required<CleanupOptions>): Promise<void>;
    logUrl(state: S): string;
    invoke(state: S, request: Invocation): Promise<ResponseMessageReceived | void>;
    publish(state: S, message: SendableMessage): Promise<void>;
    poll(state: S): Promise<PollResult>;
    responseQueueId(state: S): string | void;
}
