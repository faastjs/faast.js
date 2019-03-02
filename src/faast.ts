import { EventEmitter } from "events";
import * as path from "path";
import * as util from "util";
import * as uuidv4 from "uuid/v4";
import { _parentModule } from "../index";
import { AwsImpl, AwsOptions, AwsState } from "./aws/aws-faast";
import { CostBreakdown, CostMetric } from "./cost";
import { GoogleImpl, GoogleOptions, GoogleState } from "./google/google-faast";
import { LocalImpl, LocalOptions, LocalState } from "./local/local-faast";
import { inspectProvider, log } from "./log";
import {
    CallId,
    CleanupOptionDefaults,
    CleanupOptions,
    CloudFunctionImpl,
    CommonOptions,
    FunctionCounters,
    FunctionStats,
    Invocation,
    StopQueueMessage,
    UUID
} from "./provider";
import {
    assertNever,
    ExponentiallyDecayingAverageValue,
    FactoryMap,
    roundTo100ms,
    sleep,
    SmallestN,
    Statistics
} from "./shared";
import { Deferred, Funnel, Pump } from "./throttle";
import { NonFunctionProperties, Unpacked } from "./types";
import { CpuMeasurement, FunctionCall, FunctionReturn, serializeCall } from "./wrapper";
import Module = require("module");

/**
 * @public
 */
export const providers: Provider[] = ["aws", "google", "local"];

/**
 * @public
 */
export class FaastError extends Error {
    /** The log URL for the specific invocation that caused this error. */
    logUrl?: string;
    constructor(errObj: any, logUrl?: string) {
        let message = errObj.message;
        if (logUrl) {
            message += `\nlogs: ${logUrl} `;
        }
        super(message);
        if (Object.keys(errObj).length === 0 && !(errObj instanceof Error)) {
            log.warn(
                `Error response object has no keys, likely a bug in faast (not serializing error objects)`
            );
        }
        this.logUrl = logUrl;
        this.name = errObj.name;
        this.stack = errObj.stack;
    }
}

/**
 * @internal
 */
export interface ResponseDetails<D> {
    value: Promise<D>;
    rawResponse: any;
    executionId?: string;
    logUrl?: string;
    localStartLatency?: number;
    remoteStartLatency?: number;
    executionTime?: number;
    sendResponseLatency?: number;
    returnLatency?: number;
}

/**
 * @internal
 */
export type Response<D> = ResponseDetails<Unpacked<D>>;

/**
 * @public
 */
export type PromisifiedFunction<A extends any[], R> = (
    ...args: A
) => Promise<Unpacked<R>>;

/**
 * @public
 */
export type Promisified<M> = {
    [K in keyof M]: M[K] extends (...args: infer A) => infer R
        ? PromisifiedFunction<A, R>
        : never
};

/**
 * @internal
 */
type ResponsifiedFunction<A extends any[], R> = (...args: A) => Promise<Response<R>>;

function resolveModule(fmodule: string) {
    if (path.isAbsolute(fmodule)) {
        return fmodule;
    }
    if (!_parentModule) {
        throw new Error(`Could not resolve fmodule ${fmodule}`);
    }
    if (_parentModule.filename.match(/aws-faast/)) {
        log.info(
            `WARNING: import faast before aws-faast to avoid problems with module resolution`
        );
    }
    return (Module as any)._resolveFilename(fmodule, _parentModule);
}

export class FunctionCountersMap {
    aggregate = new FunctionCounters();
    fIncremental = new FactoryMap(() => new FunctionCounters());
    fAggregate = new FactoryMap(() => new FunctionCounters());

    incr(fn: string, key: keyof NonFunctionProperties<FunctionCounters>, n: number = 1) {
        this.fIncremental.getOrCreate(fn)[key] += n;
        this.fAggregate.getOrCreate(fn)[key] += n;
        this.aggregate[key] += n;
    }

    resetIncremental() {
        this.fIncremental.clear();
    }

    toString() {
        return [...this.fAggregate].map(([key, value]) => `[${key}] ${value}`).join("\n");
    }

    clear() {
        this.fIncremental.clear();
        this.fAggregate.clear();
    }
}

export class FunctionStatsMap {
    fIncremental = new FactoryMap(() => new FunctionStats());
    fAggregate = new FactoryMap(() => new FunctionStats());
    aggregate = new FunctionStats();

    update(fn: string, key: keyof NonFunctionProperties<FunctionStats>, value: number) {
        this.fIncremental.getOrCreate(fn)[key].update(value);
        this.fAggregate.getOrCreate(fn)[key].update(value);
        this.aggregate[key].update(value);
    }

    resetIncremental() {
        this.fIncremental.clear();
    }

    toString() {
        return [...this.fAggregate].map(([key, value]) => `[${key}] ${value}`).join("\n");
    }

    clear() {
        this.fIncremental.clear();
        this.fAggregate.clear();
    }
}

class FunctionCpuUsage {
    utime = new Statistics();
    stime = new Statistics();
    cpuTime = new Statistics();
    smallest = new SmallestN(100);
}

class FunctionCpuUsagePerSecond extends FactoryMap<number, FunctionCpuUsage> {
    constructor() {
        super(() => new FunctionCpuUsage());
    }
}

class FunctionMemoryStats {
    rss = new Statistics();
    heapTotal = new Statistics();
    heapUsed = new Statistics();
    external = new Statistics();
}

class FunctionMemoryCounters {
    heapUsedGrowth = 0;
    externalGrowth = 0;
}

class MemoryLeakDetector {
    private instances = new FactoryMap(() => new FunctionMemoryStats());
    private counters = new FactoryMap(() => new FunctionMemoryCounters());
    private warned = new Set<string>();
    private memorySize: number;

    constructor(memorySize?: number) {
        this.memorySize = memorySize || 100;
    }

    detectedNewLeak(fn: string, instanceId: string, memoryUsage: NodeJS.MemoryUsage) {
        if (this.warned.has(fn)) {
            return false;
        }
        const { rss, heapTotal, heapUsed, external } = memoryUsage;
        const instanceStats = this.instances.getOrCreate(instanceId);
        const counters = this.counters.getOrCreate(instanceId);
        if (heapUsed > instanceStats.heapUsed.max) {
            counters.heapUsedGrowth++;
        } else {
            counters.heapUsedGrowth = 0;
        }
        if (external > instanceStats.external.max) {
            counters.externalGrowth++;
        } else {
            counters.externalGrowth = 0;
        }
        instanceStats.rss.update(rss);
        instanceStats.heapTotal.update(heapTotal);
        instanceStats.heapUsed.update(heapUsed);
        instanceStats.external.update(external);

        if (
            heapUsed > this.memorySize * 0.8 * 2 ** 20 ||
            external > this.memorySize * 0.8 * 2 ** 20
        ) {
            if (counters.heapUsedGrowth > 4 || counters.externalGrowth > 4) {
                this.warned.add(fn);
                return true;
            }
        }
        return false;
    }

    clear() {
        this.instances.clear();
        this.counters.clear();
        this.warned.clear();
    }
}

interface FunctionReturnWithMetrics extends FunctionReturn {
    rawResponse: any;
    localRequestSentTime: number;
    localEndTime: number;
    remoteResponseSentTime?: number;
}

function processResponse<R>(
    returned: FunctionReturnWithMetrics,
    callRequest: FunctionCall,
    localStartTime: number,
    fcounters: FunctionCountersMap,
    fstats: FunctionStatsMap,
    prevSkew: ExponentiallyDecayingAverageValue,
    memoryLeakDetector: MemoryLeakDetector
) {
    const { executionId, logUrl, instanceId, memoryUsage } = returned;
    let value: Promise<Unpacked<R>>;
    if (returned.type === "error") {
        let error = returned.value;
        if (returned.isErrorObject) {
            error = new FaastError(returned.value, logUrl);
        }
        value = Promise.reject(error);
        value.catch(_silenceWarningLackOfSynchronousCatch => {});
    } else {
        value = Promise.resolve(returned.value);
    }
    const {
        localRequestSentTime,
        remoteResponseSentTime,
        localEndTime,
        rawResponse
    } = returned;
    let rv: Response<R> = {
        value,
        executionId,
        logUrl,
        rawResponse
    };
    const fn = callRequest.name;
    const { remoteExecutionStartTime, remoteExecutionEndTime } = returned;

    if (remoteExecutionStartTime && remoteExecutionEndTime) {
        const localStartLatency = localRequestSentTime - localStartTime;
        const roundTripLatency = localEndTime - localRequestSentTime;
        const executionTime = remoteExecutionEndTime - remoteExecutionStartTime;
        const sendResponseLatency = Math.max(
            0,
            (remoteResponseSentTime || remoteExecutionEndTime) - remoteExecutionEndTime
        );
        const networkLatency = roundTripLatency - executionTime - sendResponseLatency;
        const estimatedRemoteStartTime = localRequestSentTime + networkLatency / 2;
        const estimatedSkew = estimatedRemoteStartTime - remoteExecutionStartTime;
        let skew = estimatedSkew;
        if (fcounters.aggregate.completed > 1) {
            prevSkew.update(skew);
            skew = prevSkew.value;
        }

        const remoteStartLatency = Math.max(
            1,
            remoteExecutionStartTime + skew - localRequestSentTime
        );
        const returnLatency = Math.max(1, localEndTime - (remoteExecutionEndTime + skew));
        fstats.update(fn, "localStartLatency", localStartLatency);
        fstats.update(fn, "remoteStartLatency", remoteStartLatency);
        fstats.update(fn, "executionTime", executionTime);
        fstats.update(fn, "sendResponseLatency", sendResponseLatency);
        fstats.update(fn, "returnLatency", returnLatency);

        const billed = (executionTime || 0) + (sendResponseLatency || 0);
        const estimatedBilledTime = Math.max(100, Math.ceil(billed / 100) * 100);
        fstats.update(fn, "estimatedBilledTime", estimatedBilledTime);
        rv = {
            ...rv,
            localStartLatency,
            remoteStartLatency,
            executionTime: executionTime,
            sendResponseLatency,
            returnLatency
        };
    }

    if (returned.type === "error") {
        fcounters.incr(fn, "errors");
    } else {
        fcounters.incr(fn, "completed");
    }

    if (instanceId && memoryUsage) {
        if (memoryLeakDetector.detectedNewLeak(fn, instanceId, memoryUsage)) {
            log.leaks(`Possible memory leak detected in function '${fn}'.`);
            log.leaks(
                `Memory use before execution leaked from prior calls: %O`,
                memoryUsage
            );
            log.leaks(`Logs: ${logUrl} `);
            log.leaks(
                `These logs show only one example faast function invocation that may have a leak.`
            );
        }
    }

    return rv;
}

async function createFunction<M extends object, O extends CommonOptions, S>(
    fmodule: M,
    modulePath: string,
    impl: CloudFunctionImpl<O, S>,
    userOptions?: O
): Promise<CloudFunction<M, O, S>> {
    try {
        const resolvedModule = resolveModule(modulePath);
        const functionId = uuidv4() as UUID;
        const options = Object.assign({}, impl.defaults, userOptions);
        log.provider(`options ${inspectProvider(options)}`);
        return new CloudFunction(
            impl,
            await impl.initialize(resolvedModule, functionId, options),
            fmodule,
            resolvedModule,
            options
        );
    } catch (err) {
        log.warn(`faast: createFunction error: ${err}`);
        throw err;
    }
}

/**
 * Summarize statistics about remote function invocations.
 * @public
 */
export class FunctionStatsEvent {
    constructor(
        readonly fn: string,
        readonly counters: FunctionCounters,
        readonly stats?: FunctionStats
    ) {}

    toString() {
        const executionTime = this.stats ? this.stats.executionTime.mean : 0;
        return `[${this.fn}] ${this.counters}, executionTime: ${(
            executionTime / 1000
        ).toFixed(2)}s`;
    }
}

class PendingRequest extends Deferred<FunctionReturnWithMetrics> {
    created: number = Date.now();
    executing?: boolean;
    serialized: string;

    constructor(readonly call: FunctionCall) {
        super();
        this.serialized = serializeCall(call);
    }
}

/**
 * @public
 */
export class CloudFunction<
    M extends object,
    O extends CommonOptions = CommonOptions,
    S = any
> {
    cloudName = this.impl.name;
    functions: Promisified<M>;
    /** @internal */
    counters = new FunctionCountersMap();
    /** @internal */
    stats = new FunctionStatsMap();
    private _cpuUsage = new FactoryMap(() => new FunctionCpuUsagePerSecond());
    private _memoryLeakDetector: MemoryLeakDetector;
    private _funnel: Funnel<any>;
    private _skew = new ExponentiallyDecayingAverageValue(0.3);
    private _statsTimer?: NodeJS.Timer;
    private _cleanupHooks: Set<Deferred> = new Set();
    private _initialInvocationTime = new FactoryMap(() => Date.now());
    private _callResultsPending: Map<CallId, PendingRequest> = new Map();
    private _collectorPump: Pump<void>;
    private _emitter = new EventEmitter();

    /**
     * Constructor
     * @internal
     */
    constructor(
        private impl: CloudFunctionImpl<O, S>,
        readonly state: S,
        private fmodule: M,
        private modulePath: string,
        readonly options: Required<CommonOptions>
    ) {
        log.info(`Node version: ${process.version}`);
        log.provider(`name: ${this.impl.name}`);
        log.provider(`responseQueueId: ${this.impl.responseQueueId(state)}`);
        log.provider(`logUrl: ${this.impl.logUrl(state)}`);
        log.info(`Log url: ${impl.logUrl(state)}`);

        this._funnel = new Funnel<any>(options.concurrency);
        this._memoryLeakDetector = new MemoryLeakDetector(options.memorySize);
        const functions: any = {};
        for (const name of Object.keys(fmodule)) {
            if (typeof (fmodule as any)[name] === "function") {
                functions[name] = this.wrapFunction((fmodule as any)[name]);
            }
        }
        this.functions = functions;
        this._collectorPump = new Pump(2, () => this.resultCollector());
        this._collectorPump.start();
    }

    async cleanup(userCleanupOptions: CleanupOptions = {}) {
        try {
            const options = Object.assign({}, CleanupOptionDefaults, userCleanupOptions);
            this.counters.clear();
            this.stats.clear();
            this._memoryLeakDetector.clear();
            this._funnel.clear();
            this._cleanupHooks.forEach(hook => hook.resolve());
            this._cleanupHooks.clear();
            this.stopStats();
            this._initialInvocationTime.clear();
            this._callResultsPending.clear();
            this._collectorPump.stop();

            let count = 0;
            const tasks = [];
            const stopMessage: StopQueueMessage = { kind: "stopqueue" };
            while (this._collectorPump.getConcurrency() > 0 && count++ < 10) {
                for (let i = 0; i < this._collectorPump.getConcurrency(); i++) {
                    log.provider(`publish ${inspectProvider(stopMessage)}`);
                    tasks.push(this.impl.publish(this.state, stopMessage));
                }
                await Promise.all(tasks);
                if (this._collectorPump.getConcurrency() > 0) {
                    await sleep(1000);
                }
            }

            log.provider(`cleanup`);
            await this.impl.cleanup(this.state, options);
            log.provider(`cleanup done`);
        } catch (err) {
            log.warn(`faast: cleanup error ${err}`);
            throw err;
        }
    }

    /** The logs for all invocations. May require logging in to the provider. */
    logUrl() {
        const rv = this.impl.logUrl(this.state);
        log.provider(`logUrl ${rv}`);
        return rv;
    }

    private startStats(interval: number = 1000) {
        this._statsTimer = setInterval(() => {
            this.counters.fIncremental.forEach((counters, fn) => {
                const stats = this.stats.fIncremental.get(fn);
                this._emitter.emit("stats", new FunctionStatsEvent(fn, counters, stats));
            });

            this.counters.resetIncremental();
            this.stats.resetIncremental();
        }, interval);
    }

    private stopStats() {
        this._statsTimer && clearInterval(this._statsTimer);
        this._statsTimer = undefined;
    }

    /**
     * Register for statistics events that provide ongoing details about the
     * progress of in-flight invocations.
     */
    on(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void) {
        if (!this._statsTimer) {
            this.startStats();
        }
        this._emitter.on(name, listener);
    }

    /**
     * Deregister a listener for statistics on in-flight invocations.
     */
    off(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void) {
        this._emitter.off(name, listener);
        if (this._emitter.listenerCount(name) === 0) {
            this.stopStats();
        }
    }

    private async withCancellation<T>(
        fn: (cancel: Promise<void>) => Promise<T>
    ): Promise<T> {
        const deferred = new Deferred();
        this._cleanupHooks.add(deferred);
        const promise = fn(deferred.promise);
        try {
            await promise;
        } catch (err) {
        } finally {
            this._cleanupHooks.delete(deferred);
        }
        return promise;
    }

    private wrapFunctionWithResponse<A extends any[], R>(
        fn: (...args: A) => R
    ): ResponsifiedFunction<A, R> {
        return async (...args: A) => {
            let retries = 0;
            const startTime = Date.now();
            const initialInvocationTime = this._initialInvocationTime.getOrCreate(
                fn.name
            );
            // XXX capture google retries in stats?

            const shouldRetry = () => {
                if (retries < this.options.maxRetries) {
                    retries++;
                    this.counters.incr(fn.name, "retries");
                    return true;
                }
                return false;
            };

            const invoke = async () => {
                const callId = uuidv4();
                log.calls(`Calling '${fn.name}' (${callId})`);
                const ResponseQueueId =
                    this.impl.responseQueueId(this.state) || undefined;
                const callObject: FunctionCall = {
                    name: fn.name,
                    args,
                    callId,
                    modulePath: this.modulePath,
                    ResponseQueueId
                };
                const pending = new PendingRequest(callObject);
                this._callResultsPending.set(callId, pending);

                const invokeCloudFunction = () => {
                    this.counters.incr(fn.name, "invocations");
                    const invocation: Invocation = {
                        callId,
                        body: pending.serialized
                    };
                    log.provider(`invoke ${inspectProvider(invocation)}`);
                    this.withCancellation(async cancel => {
                        const message = await this.impl
                            .invoke(this.state, invocation, cancel)
                            .catch(err => pending.reject(err));
                        if (message) {
                            log.provider(`invoke returned ${inspectProvider(message)}`);
                            let returned = message.body;
                            if (typeof returned === "string")
                                returned = JSON.parse(returned) as FunctionReturn;
                            const response: FunctionReturnWithMetrics = {
                                ...returned,
                                callId,
                                rawResponse: message.rawResponse,
                                localRequestSentTime: pending.created,
                                localEndTime: Date.now()
                            };
                            pending.resolve(response);
                        }
                    });
                };

                const fnStats = this.stats.fAggregate.getOrCreate(fn.name);

                this.withCancellation(cancel =>
                    retryFunctionIfNeededToReduceTailLatency(
                        () => Date.now() - initialInvocationTime,
                        () =>
                            Math.max(
                                estimateTailLatency(
                                    fnStats,
                                    this.options.speculativeRetryThreshold
                                ),
                                5000
                            ),
                        async () => {
                            invokeCloudFunction();
                            await pending.promise;
                        },
                        shouldRetry,
                        cancel
                    )
                );

                const rv = await pending.promise.catch<FunctionReturnWithMetrics>(err => {
                    log.provider(`invoke promise rejection: ${err}`);
                    return {
                        type: "error",
                        callId,
                        isErrorObject: typeof err === "object" && err instanceof Error,
                        value: err,
                        rawResponse: err,
                        localEndTime: Date.now(),
                        localRequestSentTime: pending.created
                    };
                });

                this._callResultsPending.delete(rv.callId);
                log.calls(`Returning '${fn.name}' (${callId}): ${util.inspect(rv)}`);

                return processResponse<R>(
                    rv,
                    callObject,
                    startTime,
                    this.counters,
                    this.stats,
                    this._skew,
                    this._memoryLeakDetector
                );
            };

            return this._funnel.push(invoke, shouldRetry);
        };
    }

    private wrapFunction<A extends any[], R>(
        fn: (...args: A) => R
    ): PromisifiedFunction<A, R> {
        const wrappedFunc = async (...args: A) => {
            const cfn = this.wrapFunctionWithResponse(fn);
            const response = await cfn(...args);
            return response.value;
        };
        return wrappedFunc as any;
    }

    /**
     * Get a cost estimate report summarizing the cost of all completed
     * invocations so far.
     */
    async costEstimate() {
        if (this.impl.costEstimate) {
            const estimate = await this.impl.costEstimate(
                this.state,
                this.counters.aggregate,
                this.stats.aggregate
            );
            log.provider(`costEstimate returned ${inspectProvider(estimate)}`);
            if (this.counters.aggregate.retries > 0) {
                const { retries, invocations } = this.counters.aggregate;
                const retryPct = ((retries / invocations) * 100).toFixed(1);
                estimate.push(
                    new CostMetric({
                        name: "retries",
                        pricing: 0,
                        measured: retries,
                        unit: "retry",
                        unitPlural: "retries",
                        comment: `Retries were ${retryPct}% of requests and may have incurred charges not accounted for by faast.`,
                        informationalOnly: true
                    })
                );
            }
            return estimate;
        } else {
            const costs = new CostBreakdown();
            const billedTimeStats = this.stats.aggregate.estimatedBilledTime;
            const seconds = (billedTimeStats.mean / 1000) * billedTimeStats.samples || 0;

            const functionCallDuration = new CostMetric({
                name: "functionCallDuration",
                pricing: 0,
                unit: "second",
                measured: seconds,
                informationalOnly: true
            });
            costs.push(functionCallDuration);

            const functionCallRequests = new CostMetric({
                name: "functionCallRequests",
                pricing: 0,
                measured: this.counters.aggregate.invocations,
                unit: "request",
                informationalOnly: true
            });
            costs.push(functionCallRequests);
            return costs;
        }
    }

    private async resultCollector() {
        const { _callResultsPending: callResultsPending } = this;
        if (!callResultsPending.size) {
            return;
        }

        log.provider(`polling ${this.impl.responseQueueId(this.state)}`);
        const pollResult = await this.withCancellation(cancel =>
            this.impl.poll(this.state, cancel)
        );
        log.provider(`poll returned ${inspectProvider(pollResult)}`);
        const { Messages, isFullMessageBatch } = pollResult;
        const localEndTime = Date.now();
        this.adjustCollectorConcurrencyLevel(isFullMessageBatch);

        for (const m of Messages) {
            switch (m.kind) {
                case "stopqueue":
                    return;
                case "deadletter":
                    const callRequest = callResultsPending.get(m.callId);
                    log.info(`Error "${m.message}" in call request %O`, callRequest);
                    if (callRequest) {
                        log.info(`Rejecting CallId: ${m.callId}`);
                        callRequest.reject(new Error(m.message));
                    }
                    break;
                case "functionstarted":
                    const deferred = callResultsPending.get(m.callId);
                    if (deferred) {
                        deferred!.executing = true;
                    }
                    break;
                case "response":
                    try {
                        const { body, timestamp } = m;
                        const returned: FunctionReturn =
                            typeof body === "string" ? JSON.parse(body) : body;
                        const deferred = callResultsPending.get(m.callId);
                        if (deferred) {
                            const rv: FunctionReturnWithMetrics = {
                                ...returned,
                                rawResponse: m,
                                remoteResponseSentTime: timestamp,
                                localRequestSentTime: deferred.created,
                                localEndTime
                            };
                            log.provider(`returned ${inspectProvider(returned)}`);
                            deferred.resolve(rv);
                        } else {
                            log.info(
                                `Deferred promise not found for CallId: ${m.callId}`
                            );
                        }
                    } catch (err) {
                        log.warn(err);
                    }
                    break;
                case "cpumetrics":
                    const { metrics } = m;
                    const pending = callResultsPending.get(m.callId);
                    if (!pending) {
                        return;
                    }
                    const stats = this._cpuUsage.getOrCreate(pending.call.name);
                    const secondMetrics = stats.getOrCreate(
                        Math.round(metrics.elapsed / 1000)
                    );
                    secondMetrics.stime.update(metrics.stime);
                    secondMetrics.utime.update(metrics.utime);
                    secondMetrics.cpuTime.update(metrics.stime + metrics.utime);
                    break;
                default:
                    assertNever(m);
            }
        }
    }

    private adjustCollectorConcurrencyLevel(full?: boolean) {
        const nPending = this._callResultsPending.size;
        if (nPending > 0) {
            let nCollectors = full ? Math.floor(nPending / 20) + 2 : 2;
            nCollectors = Math.min(nCollectors, 10);
            const pump = this._collectorPump;
            const previous = pump.concurrency;
            pump.setMaxConcurrency(nCollectors);
            if (previous !== pump.concurrency) {
                log.info(
                    `Result collectors running: ${pump.getConcurrency()}, new max: ${
                        pump.concurrency
                    }`
                );
            }
        }
    }
}

/**
 * A CloudFunction type suitable to hold the return value of `faast("aws", ...)`
 * @public
 */
export class AWSLambda<M extends object = object> extends CloudFunction<
    M,
    AwsOptions,
    AwsState
> {}
/**
 * A CloudFunction type suitable to hold the return value of `faast("google", ...)`
 * @public
 */
export class GoogleCloudFunction<M extends object = object> extends CloudFunction<
    M,
    GoogleOptions,
    GoogleState
> {}

/**
 * A CloudFunction type suitable to hold the return value of `faast("local", ...)`
 * @public
 */
export class LocalFunction<M extends object = object> extends CloudFunction<
    M,
    LocalOptions,
    LocalState
> {}

/**
 * The type of all supported cloud providers.
 * @public
 */
export type Provider = "aws" | "google" | "local";

/**
 * The main entry point for faast.
 * @public
 */
export function faast<M extends object>(
    provider: "aws",
    fmodule: M,
    modulePath: string,
    options?: AwsOptions
): Promise<CloudFunction<M, AwsOptions, AwsState>>;
/**
 * The main entry point for faast.
 * @public
 */
export function faast<M extends object>(
    provider: "google",
    fmodule: M,
    modulePath: string,
    options?: GoogleOptions
): Promise<CloudFunction<M, GoogleOptions, GoogleState>>;
/**
 * The main entry point for faast.
 * @public
 */
export function faast<M extends object>(
    provider: "local",
    fmodule: M,
    modulePath: string,
    options?: LocalOptions
): Promise<CloudFunction<M, LocalOptions, LocalState>>;
/**
 * The main entry point for faast.
 * @public
 */
export function faast<M extends object, S>(
    provider: Provider,
    fmodule: M,
    modulePath: string,
    options?: CommonOptions
): Promise<CloudFunction<M, CommonOptions, S>>;
/**
 * The main entry point for faast.
 * @public
 */
export async function faast<M extends object, O extends CommonOptions, S>(
    provider: Provider,
    fmodule: M,
    modulePath: string,
    options?: O
): Promise<CloudFunction<M, O, S>> {
    let impl: any;
    switch (provider) {
        case "aws":
            impl = AwsImpl;
            break;
        case "google":
            impl = GoogleImpl;
            break;
        case "local":
            impl = LocalImpl;
            break;
        default:
            throw new Error(`Unknown cloud provider option '${provider}'`);
    }
    return createFunction<M, O, S>(fmodule, modulePath, impl, options);
}

function estimateFunctionLatency(fnStats: FunctionStats) {
    const {
        executionTime,
        localStartLatency,
        remoteStartLatency,
        returnLatency
    } = fnStats;

    return (
        localStartLatency.mean +
            remoteStartLatency.mean +
            executionTime.mean +
            returnLatency.mean || 0
    );
}

function estimateTailLatency(fnStats: FunctionStats, nStdDev: number) {
    return estimateFunctionLatency(fnStats) + nStdDev * fnStats.executionTime.stdev;
}

async function retryFunctionIfNeededToReduceTailLatency(
    timeSinceInitialInvocation: () => number,
    getTimeout: () => number,
    worker: () => Promise<void>,
    shouldRetry: () => boolean,
    cancel: Promise<void>
) {
    let pending = true;
    let lastInvocationTime: number = Date.now();

    cancel.then(() => (pending = false));

    const doWork = async () => {
        lastInvocationTime = Date.now();
        await worker().catch(_ => {});
        pending = false;
    };

    const latency = () => Date.now() - lastInvocationTime;

    doWork();

    while (pending) {
        const timeout = getTimeout();
        if (latency() >= timeout && timeSinceInitialInvocation() > timeout + 1000) {
            if (shouldRetry()) {
                doWork();
            } else {
                return;
            }
        }
        const waitTime = roundTo100ms(Math.max(timeout - latency(), 5000));
        await sleep(waitTime, cancel);
    }
}

async function proactiveRetry(
    cpuUsage: CpuMeasurement,
    elapsed: number,
    secondMap: FunctionCpuUsagePerSecond
) {
    const time = cpuUsage.utime + cpuUsage.stime;
    const rounded = Math.round(elapsed);
    const stats = secondMap.get(rounded);
}
