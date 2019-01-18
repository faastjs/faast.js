import { PackerOptions, CleanupOptions } from "./options";
import { PackerResult } from "./packer";
import { CostBreakdown } from "./cost";
import { Statistics } from "./shared";
import { FunctionReturn, FunctionCall } from "./wrapper";

export const CALLID_ATTR = "__faast_callid__";
export const KIND_ATTR = "__faast_kind__";

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

export interface CloudFunctionImpl<O, S> {
    name: string;
    defaults: Required<O>;

    initialize(
        serverModule: string,
        functionId: string,
        options?: Required<O>
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
