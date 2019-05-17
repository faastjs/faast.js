import { EventEmitter } from "events";
import { dirname } from "path";
import * as util from "util";
import * as uuidv4 from "uuid/v4";
import { _parentModule } from "../index";
import { AwsImpl, AwsOptions, AwsState } from "./aws/aws-faast";
import { CostMetric, CostSnapshot } from "./cost";
import { assertNever, FaastError, synthesizeFaastError } from "./error";
import { GoogleImpl, GoogleOptions, GoogleState } from "./google/google-faast";
import { LocalImpl, LocalOptions, LocalState } from "./local/local-faast";
import { inspectProvider, log } from "./log";
import {
    FactoryMap,
    FunctionCpuUsage,
    FunctionStatsMap,
    MemoryLeakDetector
} from "./metrics";
import {
    CallId,
    CleanupOptionDefaults,
    CleanupOptions,
    CommonOptions,
    FunctionStats,
    Provider,
    ProviderImpl,
    UUID
} from "./provider";
import {
    deserializeFunctionReturn,
    ESERIALIZE,
    serializeFunctionCall
} from "./serialize";
import { ExponentiallyDecayingAverageValue, roundTo100ms, sleep } from "./shared";
import { Deferred, Funnel, Pump } from "./throttle";
import { Unpacked } from "./types";
import {
    CpuMeasurement,
    FunctionCall,
    FunctionCallSerialized,
    FunctionReturn
} from "./wrapper";
import Module = require("module");

/**
 * An array of all available provider.
 * @public
 */
export const providers: Provider[] = ["aws", "google", "local"];

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
 * The type of functions on {@link FaastModule.functions}. Used by
 * {@link Promisified}.
 *  @remarks
 * Given argument types A and return type R of a function,
 * `PromisifiedFunction<A,R>` is a type with the same signature except the
 * return value is replaced with a Promise. If the original function already
 * returned a promise, the signature is unchanged.
 *  @public
 */
export type PromisifiedFunction<A extends any[], R> = (
    ...args: A
) => Promise<Unpacked<R>>;

/**
 * `Promisified<M>` is the type of {@link FaastModule.functions}.
 * @remarks
 * `Promisified<M>` maps an imported module's functions to promise-returning
 * versions of those functions (see {@link PromisifiedFunction}). Non-function
 * exports of the module are omitted.
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
    fstats: FunctionStatsMap,
    prevSkew: ExponentiallyDecayingAverageValue,
    memoryLeakDetector: MemoryLeakDetector
) {
    const { executionId, logUrl, instanceId, memoryUsage } = returned;
    let value: Promise<Unpacked<R>>;
    const fn = callRequest.name;
    if (returned.type === "error") {
        const error = returned.isErrorObject
            ? synthesizeFaastError(returned.value, logUrl, fn, callRequest.args)
            : returned.value;
        value = Promise.reject(error);
        value.catch(_silenceWarningLackOfSynchronousCatch => {});
    } else {
        value = Promise.resolve(returned.value[0]);
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
        if (fstats.aggregate.completed > 1) {
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
            executionTime,
            sendResponseLatency,
            returnLatency
        };
    }

    if (returned.type === "error") {
        fstats.incr(fn, "errors");
    } else {
        fstats.incr(fn, "completed");
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
                `These logs show only one example faast cloud function invocation that may have a leak.`
            );
        }
    }

    return rv;
}

async function createFaastModuleProxy<M extends object, O extends CommonOptions, S>(
    impl: ProviderImpl<O, S>,
    fmodule: M,
    userOptions?: O
): Promise<FaastModuleProxy<M, O, S>> {
    try {
        const resolvedModule = resolve(fmodule);
        const functionId = uuidv4() as UUID;
        const options = { ...impl.defaults, ...userOptions };
        log.provider(`options ${inspectProvider(options)}`);
        return new FaastModuleProxy(
            impl,
            await impl.initialize(
                resolvedModule,
                functionId,
                options,
                dirname(_parentModule!.filename)
            ),
            fmodule,
            resolvedModule,
            options
        );
    } catch (err) {
        throw new FaastError(err, "could not initialize cloud function");
    }
}

/**
 * Summarize statistics about cloud function invocations.
 * @public
 */
export class FunctionStatsEvent {
    readonly stats: FunctionStats;
    /**
     * @param fn - The name of the cloud function the statistics are about.
     * @param stats - See {@link FunctionStats}
     */
    constructor(readonly fn: string, stats: FunctionStats) {
        this.stats = stats.clone();
    }

    /**
     * Returns a string summarizing the statistics event.
     * @remarks
     * The string includes number of completed calls, errors, and retries, and
     * the mean execution time for the calls that completed within the last time
     * interval (1s).
     */
    toString() {
        const executionTime = this.stats ? this.stats.executionTime.mean : 0;
        return `[${this.fn}] ${this.stats}, executionTime: ${(
            executionTime / 1000
        ).toFixed(2)}s`;
    }
}

class PendingRequest extends Deferred<FunctionReturnWithMetrics> {
    created: number = Date.now();
    executing?: boolean;
    serialized: FunctionCallSerialized;

    constructor(readonly call: FunctionCall, validate: boolean) {
        super();
        this.serialized = serializeFunctionCall(call, validate);
    }
}

/**
 * The main interface for invoking, cleaning up, and managing faast.js cloud
 * functions. Returned by {@link faast}.
 * @public
 */
export interface FaastModule<M extends object> {
    /** See {@link Provider}.  */
    provider: Provider;
    /**
     * Each call of a cloud function creates a separate remote invocation.
     * @remarks
     * The module passed into {@link faast} or its provider-specific variants
     * ({@link faastAws}, {@link faastGoogle}, and {@link faastLocal}) is mapped
     * to a {@link Promisified} version of the module, which performs the
     * following mapping:
     *
     * - All function exports that return promises have their type signatures
     *   preserved as-is.
     *
     * - All function exports that return type T where T is not a Promise, are
     *   mapped to functions that return Promise<T>. Argument types are
     *   preserved as-is.
     *
     * - All non-function exports are omitted in the Promisified module.
     *
     * Arguments and return values are serialized with `JSON.stringify` when
     * cloud functions are called, therefore what is received on the remote side
     * might not match what was sent. Faast.js attempts to detect nonsupported
     * arguments on a best effort basis.
     *
     * If the cloud function throws an exception or rejects its promise with an
     * instance of `Error`, then the function will reject with
     * {@link FaastError} on the local side. If the exception or rejection
     * resolves to any value that is not an instance of `Error`, the remote
     * function proxy will reject with the value of
     * `JSON.parse(JSON.stringify(err))`.
     *
     * Arguments and return values have size limitations that vary by provider
     * and mode:
     *
     * - AWS: 256KB in queue mode, 6MB in https mode. See
     *   {@link https://docs.aws.amazon.com/lambda/latest/dg/limits.html | AWS Lambda Limits}.
     *
     * - Google: 10MB in https and queue modes. See
     *   {@link https://cloud.google.com/functions/quotas | Google Cloud Function Quotas}.
     *
     * - Local: limited only by available memory and the limits of
     *   {@link https://nodejs.org/api/child_process.html#child_process_subprocess_send_message_sendhandle_options_callback | childprocess.send}.
     *
     * Note that payloads may be base64 encoded for some providers and therefore
     * different in size than the original payload. Also, some bookkeeping data
     * are passed along with arguments and contribute to the size limit.
     */
    functions: Promisified<M>;
    /**
     * Stop the faast.js runtime for this cloud function and clean up ephemeral
     * cloud resources.
     * @param options - See {@link CleanupOptions}.
     * @returns a Promise that resolves when the `FaastModule` runtime stops and
     * ephemeral resources have been deleted.
     * @remarks
     * It is best practice to always call `cleanup` when done with a cloud
     * function. A typical way to ensure this in normal execution is to use the
     * `finally` construct:
     *
     * ```typescript
     * const faastModule = await faast("aws", m);
     * try {
     *     // Call faastModule.functions.*
     * } finally {
     *     // Note the `await`
     *     await faastModule.cleanup();
     * }
     * ```
     *
     * After the cleanup promise resolves, the cloud function instance can no
     * longer invoke new calls on {@link FaastModule.functions}. However, other
     * methods on {@link FaastModule} are safe to call, such as
     * {@link FaastModule.costSnapshot}.
     *
     * Cleanup also stops statistics events (See {@link FaastModule.off}).
     *
     * By default, cleanup will delete all ephemeral cloud resources but leave
     * behind cached resources for use by future cloud functions. Deleted
     * resources typically include cloud functions, queues, and queue
     * subscriptions. Logs are not deleted by cleanup.
     *
     * Note that `cleanup` leaves behind some provider-specific resources:
     *
     * - AWS: Cloudwatch logs are preserved until the garbage collector in a
     *   future cloud function instance deletes them. The default log expiration
     *   time is 24h (or the value of {@link CommonOptions.retentionInDays}). In
     *   addition, the AWS Lambda IAM role is not deleted by cleanup. This role
     *   is shared across cloud function instances. Lambda layers are also not
     *   cleaned up immediately on AWS when {@link CommonOptions.packageJson} is
     *   used and {@link CommonOptions.useDependencyCaching} is true. Cached
     *   layers are cleaned up by garbage collection. Also see
     *   {@link CleanupOptions.deleteCaches}.
     *
     * - Google: Google Stackdriver automatically deletes log entries after 30
     *   days.
     *
     * - Local: Logs are preserved in a temporary directory on local disk.
     *   Garbage collection in a future cloud function instance will delete logs
     *   older than 24h.
     */
    cleanup(options?: CleanupOptions): Promise<void>;
    /**
     * The URL of logs generated by this cloud function.
     * @remarks
     * Logs are not automatically downloaded because they cause outbound data
     * transfer, which can be expensive. Also, logs may arrive at the logging
     * service well after the cloud functions have completed. This log URL
     * specifically filters the logs for this cloud function instance.
     * Authentication is required to view cloud provider logs.
     *
     * The local provider returns a `file://` url pointing to a file for logs.
     */
    logUrl(): string;
    /**
     * Register a callback for statistics events.
     * @remarks
     * The callback is invoked once for each cloud function that was invoked
     * within the last 1s interval, with a {@link FunctionStatsEvent}
     * summarizing the statistics for each function. Typical usage:
     *
     * ```typescript
     * faastModule.on("stats", console.log);
     * ```
     */
    on(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void): void;
    /**
     * Deregister a callback for statistics events.
     * @remarks
     * Stops the callback listener from receiving future function statistics
     * events. Calling {@link FaastModule.cleanup} also turns off statistics
     * events.
     */
    off(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void): void;
    /**
     * Get a near real-time cost estimate of cloud function invocations.
     * @returns a Promise for a {@link CostSnapshot}.
     * @remarks
     * A cost snapshot provides a near real-time estimate of the costs of the
     * cloud functions invoked. The cost estimate only includes the cost of
     * successfully completed calls. Unsuccessful calls may lack the data
     * required to provide cost information. Calls that are still in flight are
     * not included in the cost snapshot. For this reason, it is typically a
     * good idea to get a cost snapshot after awaiting the result of
     * {@link FaastModule.cleanup}.
     *
     * Code example:
     *
     * ```typescript
     * const faastModule = await faast("aws", m);
     * try {
     *     // invoke cloud functions on faastModule.functions.*
     * } finally {
     *      await faastModule.cleanup();
     *      const costSnapshot = await faastModule.costSnapshot();
     *      console.log(costSnapshot);
     * }
     * ```
     */
    costSnapshot(): Promise<CostSnapshot>;

    /**
     * Statistics for a specific function or the entire faast.js module.
     *
     * @param functionName - The name of the function to retrieve statistics
     * for. If the function does not exist or has not been invoked, a new
     * instance of {@link FunctionStats} is returned with zero values. If
     * `functionName` omitted (undefined), then aggregate statistics are
     * returned that summarize all cloud functions within this faast.js module.
     * @returns an snapshot of {@link FunctionStats} at a point in time.
     */
    stats(functionName?: string): FunctionStats;
}

/**
 * Implementation of {@link FaastModule}.
 * @remarks
 * `FaastModuleProxy` provides a unified developer experience for faast.js
 * modules on top of provider-specific runtime APIs. Most users will not create
 * `FaastModuleProxy` instances themselves; instead use {@link faast}, or
 * {@link faastAws}, {@link faastGoogle}, or {@link faastLocal}.
 * `FaastModuleProxy` implements the {@link FaastModule} interface, which is the
 * preferred public interface for faast modules. `FaastModuleProxy` can be used
 * to access provider-specific details and state, and is useful for deeper
 * testing.
 * @public
 */
export class FaastModuleProxy<M extends object, O, S> implements FaastModule<M> {
    provider = this.impl.name;
    /** {@inheritdoc FaastModule.functions} */
    functions: Promisified<M>;
    /** @internal */
    private _stats = new FunctionStatsMap();
    private _cpuUsage = new FactoryMap(
        () => new FactoryMap((_: number) => new FunctionCpuUsage())
    );
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
        private impl: ProviderImpl<O, S>,
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

    /** {@inheritdoc FaastModule.cleanup} */
    async cleanup(userCleanupOptions: CleanupOptions = {}) {
        try {
            const options = { ...CleanupOptionDefaults, ...userCleanupOptions };
            this._stats.clear();
            this._memoryLeakDetector.clear();
            this._funnel.clear();
            this._cleanupHooks.forEach(hook => hook.resolve());
            this._cleanupHooks.clear();
            this._emitter.removeAllListeners();
            this.stopStats();
            this._initialInvocationTime.clear();
            this._callResultsPending.clear();
            this._collectorPump.stop();
            log.provider(`cleanup`);
            await this.impl.cleanup(this.state, options);
            log.provider(`cleanup done`);
        } catch (err) {
            throw new FaastError(err, "failed in cleanup");
        }
    }

    /** {@inheritdoc FaastModule.logUrl} */
    logUrl() {
        const rv = this.impl.logUrl(this.state);
        log.provider(`logUrl ${rv}`);
        return rv;
    }

    private startStats(interval: number = 1000) {
        this._statsTimer = setInterval(() => {
            this._stats.fIncremental.forEach((stats, fn) => {
                this._emitter.emit("stats", new FunctionStatsEvent(fn, stats));
            });

            this._stats.resetIncremental();
        }, interval);
    }

    private stopStats() {
        this._statsTimer && clearInterval(this._statsTimer);
        this._statsTimer = undefined;
    }

    /** {@inheritdoc FaastModule.on} */
    on(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void) {
        if (!this._statsTimer) {
            this.startStats();
        }
        this._emitter.on(name, listener);
    }

    /** {@inheritdoc FaastModule.off} */
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
            return await promise;
        } finally {
            this._cleanupHooks.delete(deferred);
        }
    }

    private wrapFunctionWithResponse<A extends any[], R>(
        fn: (...args: A) => R
    ): ResponsifiedFunction<A, R> {
        return async (...args: A) => {
            let retries = 0;
            const startTime = Date.now();
            let fname = fn.name;
            if (!fname) {
                for (const key of Object.keys(this.fmodule)) {
                    if ((this.fmodule as any)[key] === fn) {
                        fname = key;
                        log.info(`Found arrow function name: ${key}`);
                        break;
                    }
                }
            }
            if (!fname) {
                throw new FaastError(`Could not find function name`);
            }
            const initialInvocationTime = this._initialInvocationTime.getOrCreate(fname);

            const shouldRetry = (err: any) => {
                if (err instanceof FaastError && err.code === ESERIALIZE) {
                    return false;
                }
                if (retries < this.options.maxRetries) {
                    retries++;
                    this._stats.incr(fname, "retries");
                    return true;
                }
                return false;
            };

            const invoke = async () => {
                const callId = uuidv4();
                log.calls(`Calling '${fname}' (${callId})`);
                const ResponseQueueId =
                    this.impl.responseQueueId(this.state) || undefined;
                const callObject: FunctionCall = {
                    name: fname,
                    args,
                    callId,
                    modulePath: this.modulePath,
                    ResponseQueueId
                };
                const pending = new PendingRequest(
                    callObject,
                    this.options.validateSerialization
                );
                this._callResultsPending.set(callId, pending);

                const invokeCloudFunction = () => {
                    this._stats.incr(fname, "invocations");
                    log.provider(`invoke ${inspectProvider(pending.serialized)}`);
                    this.withCancellation(async cancel => {
                        const message = await this.impl
                            .invoke(this.state, pending.serialized, cancel)
                            .catch(err => pending.reject(err));
                        if (message) {
                            log.provider(`invoke returned ${inspectProvider(message)}`);
                            const returned = deserializeFunctionReturn(message.body);
                            log.provider(`deserialized return: %O`, returned);
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

                const fnStats = this._stats.fAggregate.getOrCreate(fname);

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
                        () => shouldRetry(undefined),
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
                log.calls(`Returning '${fname}' (${callId}): ${util.inspect(rv)}`);

                return processResponse<R>(
                    rv,
                    callObject,
                    startTime,
                    this._stats,
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

    /** {@inheritdoc FaastModule.costSnapshot} */
    async costSnapshot() {
        const estimate = await this.impl.costSnapshot(this.state, this._stats.aggregate);
        log.provider(`costSnapshot returned ${inspectProvider(estimate)}`);
        if (this._stats.aggregate.retries > 0) {
            const { retries, invocations } = this._stats.aggregate;
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
    }

    /** {@inheritdoc FaastModule.stats} */
    stats(functionName?: string) {
        if (functionName) {
            return this._stats.fAggregate.getOrCreate(functionName).clone();
        }
        return this._stats.aggregate.clone();
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
                case "deadletter":
                    const callRequest = callResultsPending.get(m.callId);
                    if (callRequest) {
                        const error = new FaastError(`dead letter message: ${m.message}`);
                        callRequest.reject(error);
                    }
                    break;
                case "functionstarted": {
                    const deferred = callResultsPending.get(m.callId);
                    if (deferred) {
                        deferred!.executing = true;
                    }
                    break;
                }
                case "response":
                    try {
                        const { body, timestamp } = m;
                        const returned = deserializeFunctionReturn(body);
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
 * The return type of {@link faastAws}. See {@link FaastModuleProxy}.
 * @public
 */
export type AwsFaastModule<M extends object = object> = FaastModuleProxy<
    M,
    AwsOptions,
    AwsState
>;

/**
 * The return type of {@link faastGoogle}. See {@link FaastModuleProxy}.
 * @public
 */
export type GoogleFaastModule<M extends object = object> = FaastModuleProxy<
    M,
    GoogleOptions,
    GoogleState
>;

/**
 * The return type of {@link faastLocal}. See {@link FaastModuleProxy}.
 * @public
 */
export type LocalFaastModule<M extends object = object> = FaastModuleProxy<
    M,
    LocalOptions,
    LocalState
>;

function resolve(fmodule: object) {
    const cache = (Module as any)._cache;
    let modulePath: string | undefined;
    for (const key of Object.keys(cache).reverse()) {
        if (cache[key].exports === fmodule) {
            modulePath = key;
            break;
        }
    }
    if (!modulePath) {
        throw new FaastError(
            {
                name: "FaastError",
                info: {
                    module: fmodule
                }
            },
            `Could not find file for module, must use "import * as X from Y" or "X = require(Y)" to load a module for faast.`
        );
    }
    log.info(`Found file: ${modulePath}`);
    return modulePath;
}

/**
 * The main entry point for faast with any provider and only common options.
 * @param provider - One of `"aws"`, `"google"`, or `"local"`. See
 * {@link Provider}.
 * @param fmodule - A module imported with `import * as X from "Y";`. Using
 * `require` also works but loses type information.
 * @param options - See {@link CommonOptions}.
 * @returns See {@link FaastModule}.
 * @remarks
 * Example of usage:
 * ```typescript
 * import { faast } from "faastjs";
 * import * as mod from "./path/to/module";
 * async function main() {
 *     const faastModule = await faast("aws", mod);
 *     try {
 *         const result = await faastModule.functions.func("arg");
 *     } finally {
 *         await faastModule.cleanup();
 *     }
 * }
 * main();
 * ```
 * @public
 */
export async function faast<M extends object>(
    provider: Provider,
    fmodule: M,
    options?: CommonOptions
): Promise<FaastModule<M>> {
    switch (provider) {
        case "aws":
            return faastAws(fmodule, options);
        case "google":
            return faastGoogle(fmodule, options);
        case "local":
            return faastLocal(fmodule, options);
        default:
            throw new FaastError(`Unknown cloud provider option '${provider}'`);
    }
}

/**
 * The main entry point for faast with AWS provider.
 * @param fmodule - A module imported with `import * as X from "Y";`. Using
 * `require` also works but loses type information.
 * @param options - Most common options are in {@link CommonOptions}.
 * Additional AWS-specific options are in {@link AwsOptions}.
 * @returns a Promise for {@link AwsFaastModule}.
 * @public
 */
export function faastAws<M extends object>(
    fmodule: M,
    options?: AwsOptions
): Promise<AwsFaastModule<M>> {
    return createFaastModuleProxy<M, AwsOptions, AwsState>(AwsImpl, fmodule, options);
}

/**
 * The main entry point for faast with Google provider.
 * @param fmodule - A module imported with `import * as X from "Y";`. Using
 * `require` also works but loses type information.
 * @param options - Most common options are in {@link CommonOptions}.
 * Additional Google-specific options are in {@link GoogleOptions}.
 * @returns a Promise for {@link GoogleFaastModule}.
 * @public
 */
export function faastGoogle<M extends object>(
    fmodule: M,
    options?: GoogleOptions
): Promise<GoogleFaastModule<M>> {
    return createFaastModuleProxy<M, GoogleOptions, GoogleState>(
        GoogleImpl,
        fmodule,
        options
    );
}

/**
 * The main entry point for faast with Local provider.
 * @param fmodule - A module imported with `import * as X from "Y";`. Using
 * `require` also works but loses type information.
 * @param options - Most common options are in {@link CommonOptions}.
 * Additional Local-specific options are in {@link LocalOptions}.
 * @returns a Promise for {@link LocalFaastModule}.
 * @public
 */
export function faastLocal<M extends object>(
    fmodule: M,
    options?: LocalOptions
): Promise<LocalFaastModule<M>> {
    return createFaastModuleProxy<M, LocalOptions, LocalState>(
        LocalImpl,
        fmodule,
        options
    );
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
    secondMap: FactoryMap<number, FunctionCpuUsage>
) {
    const time = cpuUsage.utime + cpuUsage.stime;
    const rounded = Math.round(elapsed);
    const stats = secondMap.get(rounded);
}
