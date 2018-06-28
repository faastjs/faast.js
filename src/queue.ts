import debug from "debug";
import { AutoFunnel, Deferred } from "./funnel";
import { log } from "./log";
import { FunctionCall, FunctionReturn, sleep } from "./shared";

export type Attributes = { [key: string]: string };

interface CloudFunctionQueueMessagesImpl<MessageType> {
    isStopQueueMessage(message: MessageType): boolean;
    isStartedFunctionCallMessage(message: MessageType): boolean;
    receiveMessages(): Promise<MessageType[]>;
    getMessageBody(message: MessageType): string;
    getCallId(message: MessageType): string;
}

interface CloudFunctionQueueOtherImpl {
    publish(call: FunctionCall): void;
    sendStopQueueMessage(): Promise<any>;
    description(): string;
    cleanup(): Promise<void>;
}

interface CloudFunctionQueueImpl<MessageType>
    extends CloudFunctionQueueMessagesImpl<MessageType>,
        CloudFunctionQueueOtherImpl {}

interface Vars {
    callResultsPending: Map<string, PendingRequest>;
    collectorFunnel: AutoFunnel<void>;
    retryTimer?: NodeJS.Timer;
}

interface State<MessageType> extends Vars, CloudFunctionQueueImpl<MessageType> {}

class PendingRequest extends Deferred<QueuedResponse<any>> {
    created: number = Date.now();
    executing?: boolean;
    constructor(readonly call: FunctionCall) {
        super();
    }
}

interface QueuedResponse<T> {
    returned: T;
    rawResponse: any;
}

interface CallResults<M> {
    CallId?: string;
    message: M;
    deferred?: Deferred<QueuedResponse<any>>;
}

function makeCloudFunctionQueue<MessageType>(
    impl: CloudFunctionQueueImpl<MessageType>
): State<MessageType> {
    let state: State<MessageType> = {
        ...impl,
        callResultsPending: new Map(),
        collectorFunnel: new AutoFunnel<void>(() => resultCollector(state), 10)
    };
    return state;
}

async function resultCollector<MessageType>(state: State<MessageType>) {
    const log = debug("cloudify:collector");
    let resolvePromises = (results: CallResults<MessageType>[]) => {
        for (const { message, CallId, deferred } of results) {
            if (!CallId) {
                // Can happen when a message is multiply delivered, such as retries. Ignore.
                continue;
            }
            const returned: FunctionReturn = JSON.parse(state.getMessageBody(message));
            if (deferred) {
                deferred.resolve({ returned, rawResponse: message });
            } else {
                // Caused by retries: CallId returned more than once. Ignore.
                //log(`Deferred promise not found for CallID: ${CallId}`);
            }
        }
    };

    let full = false;

    if (state.callResultsPending.size > 0) {
        log(
            `Polling response queue (size ${
                state.callResultsPending.size
            }): ${state.description()}`
        );

        const Messages = await state.receiveMessages();
        log(`received ${Messages.length} messages.`);
        if (Messages.length === 10) {
            full = true;
        }

        try {
            const callResults: CallResults<MessageType>[] = [];
            for (const m of Messages) {
                if (state.isStopQueueMessage(m)) {
                    return;
                }
                const CallId = state.getCallId(m);
                if (state.isStartedFunctionCallMessage(m)) {
                    log(`Received Function Started message CallID: ${CallId}`);
                    const deferred = state.callResultsPending.get(CallId);
                    if (deferred) {
                        deferred!.executing = true;
                    }
                } else {
                    callResults.push({
                        CallId,
                        message: m,
                        deferred: state.callResultsPending.get(CallId)
                    });
                    state.callResultsPending.delete(CallId);
                }
            }
            resolvePromises(callResults);
        } catch (err) {
            log(err);
        }
    }
    setTimeout(() => {
        startResultCollectorIfNeeded(state, full);
    }, 0);
}

// Only used when SNS fails to invoke lambda.
function retryQueue(state: Vars & CloudFunctionQueueOtherImpl) {
    const { size } = state.callResultsPending;
    const now = Date.now();
    if (size > 0 && size < 10) {
        for (let [CallId, pending] of state.callResultsPending.entries()) {
            if (!pending.executing) {
                if (now - pending.created > 4 * 1000) {
                    log(`Lambda function not started for CallId ${CallId}, retrying...`);
                    state.publish(pending.call);
                }
            }
        }
    }
}

function startResultCollectorIfNeeded(vars: Vars, full: boolean = false) {
    const nPending = vars.callResultsPending.size;
    if (nPending > 0) {
        let nCollectors = full ? Math.floor(nPending / 20) + 2 : 2;
        const funnel = vars.collectorFunnel;
        const newCollectors = funnel.fill(nCollectors);
        if (newCollectors.length > 0) {
            log(
                `Started ${
                    newCollectors.length
                } result collectors, total: ${funnel.getConcurrency()}`
            );
        }
    }
}

function startRetryTimer(vars: Vars & CloudFunctionQueueOtherImpl) {
    vars.retryTimer = setInterval(() => retryQueue(vars), 5 * 1000);
}

export function enqueueCallRequest(
    state: Vars & CloudFunctionQueueOtherImpl,
    call: FunctionCall
): Promise<QueuedResponse<any>> {
    const deferred = new PendingRequest(call);
    state.callResultsPending.set(call.CallId, deferred);
    startResultCollectorIfNeeded(state);
    state.publish(deferred.call);
    return deferred.promise;
}

export async function stop(state: Vars & CloudFunctionQueueOtherImpl) {
    state.collectorFunnel.clear();
    state.retryTimer && clearInterval(state.retryTimer);
    rejectAll(state.callResultsPending);
    let count = 0;
    let tasks = [];
    while (state.collectorFunnel.getConcurrency() > 0 && count++ < 100) {
        tasks.push(state.sendStopQueueMessage());
        await sleep(100);
    }
    await Promise.all(tasks);
}

function rejectAll(callResultsPending: Map<string, PendingRequest>) {
    log(`Rejecting ${callResultsPending.size} result promises`);
    for (const [key, promise] of callResultsPending) {
        log(`Rejecting call result: ${key}`);
        promise.reject(new Error("Call to cloud function cancelled in cleanup"));
    }
    callResultsPending.clear();
}
