import debug from "debug";
import { Deferred, Pump } from "./funnel";
import { FunctionCall, FunctionReturn, sleep } from "./shared";
const log = debug("cloudify:collector");

export interface Attributes {
    [key: string]: string;
}

const CallIdAttribute: keyof Pick<FunctionReturn, "CallId"> = "CallId";

export type ControlMessageType = "stopqueue" | "functionstarted";

export interface ReceivedMessages<M> {
    Messages: M[];
    isFullMessageBatch: boolean;
}

export class PendingRequest extends Deferred<FunctionReturn> {
    created: number = Date.now();
    executing?: boolean;
    constructor(readonly callArgsStr: string) {
        super();
    }
}

export interface QueueState {
    readonly callResultsPending: Map<string, PendingRequest>;
    readonly collectorPump: Pump<void>;
    readonly errorPump: Pump<void>;
    readonly retryTimer: NodeJS.Timer;
}

export type StateWithMessageType<M> = QueueState & QueueImpl<M>;
export type State = StateWithMessageType<{}>;

export interface QueueError {
    message: string;
    callRequest?: FunctionCall;
}

export interface QueueImpl<M> {
    publishMessage(body: string, attributes?: Attributes): Promise<any>;
    receiveMessages(): Promise<ReceivedMessages<M>>;
    getMessageAttribute(message: M, attribute: string): string | undefined;
    getMessageBody(message: M): string;
    description(): string;
    publishControlMessage(type: ControlMessageType, attr?: Attributes): Promise<any>;
    isControlMessage(message: M, type: ControlMessageType): boolean;
    receiveQueueErrors(): Promise<QueueError[]>;
}

export function initializeCloudFunctionQueue<M>(
    impl: QueueImpl<M>
): StateWithMessageType<M> {
    const state: StateWithMessageType<M> = {
        ...impl,
        callResultsPending: new Map(),
        collectorPump: new Pump<void>(2, () => resultCollector(state)),
        errorPump: new Pump<void>(1, () => errorCollector(state)),
        retryTimer: setInterval(() => retryQueue(state), 5 * 1000)
    };
    state.collectorPump.start();
    state.errorPump.start();
    return state;
}

export function enqueueCallRequest(
    state: State,
    callRequest: FunctionCall,
    ResponseQueueId: string
) {
    const request = {
        ...callRequest,
        ResponseQueueId
    };
    const deferred = new PendingRequest(JSON.stringify(request));
    state.callResultsPending.set(callRequest.CallId, deferred);
    state.publishMessage(deferred.callArgsStr);
    return deferred.promise;
}

export async function stop(state: State) {
    log(`Stopping result collector`);
    state.collectorPump.stop();
    log(`Stopping error collector`);
    state.errorPump.stop();
    clearInterval(state.retryTimer);
    rejectAll(state.callResultsPending);
    let count = 0;
    const tasks = [];
    log(`Sending stopqueue messages to collectors`);
    while (state.collectorPump.getConcurrency() > 0 && count++ < 100) {
        tasks.push(state.publishControlMessage("stopqueue"));
        await sleep(100);
    }
    await Promise.all(tasks);
}

async function resultCollector<MessageType>(state: StateWithMessageType<MessageType>) {
    const { callResultsPending } = state;
    if (!callResultsPending.size) {
        return;
    }
    log(
        `Polling response queue (size ${callResultsPending.size}: ${state.description()}`
    );

    const { Messages, isFullMessageBatch } = await state.receiveMessages();
    log(`Result collector received ${Messages.length} messages.`);
    adjustConcurrencyLevel(state, isFullMessageBatch);

    for (const m of Messages) {
        if (state.isControlMessage(m, "stopqueue")) {
            return;
        }
        const CallId = state.getMessageAttribute(m, CallIdAttribute);
        if (state.isControlMessage(m, "functionstarted")) {
            log(`Received Function Started message CallID: ${CallId}`);
            const deferred = CallId && callResultsPending.get(CallId);
            if (deferred) {
                deferred!.executing = true;
            }
        } else {
            if (CallId) {
                try {
                    const returned: FunctionReturn = JSON.parse(state.getMessageBody(m));
                    const deferred = callResultsPending.get(CallId);
                    log(`Resolving CallId: ${CallId}`);
                    callResultsPending.delete(CallId);
                    returned.rawResponse = m;
                    if (deferred) {
                        deferred.resolve(returned);
                    } else {
                        log(`Deferred promise not found for CallId: ${CallId}`);
                    }
                } catch (err) {
                    log(err);
                }
            }
        }
    }
}

async function errorCollector<MessageType>(state: StateWithMessageType<MessageType>) {
    const { callResultsPending } = state;
    log(`Error Collector polling for queue errors`);
    const queueErrors = await state.receiveQueueErrors();
    log(`Error Collector returned ${queueErrors.length} errors`);
    for (const queueError of queueErrors) {
        try {
            log(
                `Error "${queueError.message}" in call request %O`,
                queueError.callRequest
            );
            const CallId = queueError.callRequest!.CallId;
            const deferred = callResultsPending.get(CallId);
            if (deferred) {
                log(`Rejecting CallId: ${CallId}`);
                callResultsPending.delete(CallId);
                deferred.reject(new Error(queueError.message));
            }
        } catch (err) {
            log(err);
        }
    }
}

// Only used when SNS fails to invoke lambda.
function retryQueue(state: State) {
    const { size } = state.callResultsPending;
    const now = Date.now();
    if (size > 0 && size < 10) {
        for (const [CallId, pending] of state.callResultsPending.entries()) {
            if (!pending.executing) {
                if (now - pending.created > 4 * 1000) {
                    log(`Lambda function not started for CallId ${CallId}, retrying...`);
                    state.publishMessage(pending.callArgsStr);
                }
            }
        }
    }
}

function adjustConcurrencyLevel(vars: QueueState, full: boolean) {
    const nPending = vars.callResultsPending.size;
    if (nPending > 0) {
        let nCollectors = full ? Math.floor(nPending / 20) + 2 : 2;
        nCollectors = Math.min(nCollectors, 10);
        const pump = vars.collectorPump;
        const previous = pump.maxConcurrency;
        pump.setMaxConcurrency(nCollectors);
        if (previous !== pump.maxConcurrency) {
            log(
                `Result collectors running: ${pump.getConcurrency()}, new max: ${
                    pump.maxConcurrency
                }`
            );
        }
    }
}

function rejectAll(callResultsPending: Map<string, PendingRequest>) {
    log(`Rejecting ${callResultsPending.size} result promises`);
    for (const [key, pending] of callResultsPending) {
        pending.reject(
            new Error(
                `Call to cloud function cancelled in cleanup: ${pending.callArgsStr}`
            )
        );
    }
    callResultsPending.clear();
}
