import { EventEmitter } from "events";
import Module from "module";
import { fileURLToPath } from "url";
import { inspect } from "util";
import { v4 as uuidv4 } from "uuid";
import { AwsImpl, AwsOptions, AwsState } from "./aws/aws-faast";
import { CostMetric, CostSnapshot } from "./cost";
import { FaastError, FaastErrorNames, synthesizeFaastError } from "./error";
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
    IteratorResponseMessage,
    PromiseResponseMessage,
    Provider,
    ProviderImpl,
    UUID
} from "./provider";
import { deserialize, serialize, serializeFunctionArgs } from "./serialize";
import { ExponentiallyDecayingAverageValue, roundTo100ms, sleep } from "./shared";
import { AsyncOrderedQueue, Deferred, Funnel, Pump, RateLimiter } from "./throttle";
import { FunctionCall, isGenerator } from "./wrapper";

/**
 * An array of all available provider.
 * @public
 */
export const providers: Provider[] = ["aws", "google", "local"];

/**
 * `Async<T>` maps regular values to Promises and Iterators to AsyncIterators,
 * If `T` is already a Promise or an AsyncIterator, it remains the same. This
 * type is used to infer the return value of cloud functions from the types of
 * the functions in the user's input module.
 * @public
 */
export type Async<T> = T extends AsyncGenerator<infer R>
    ? AsyncGenerator<R>
    : T extends Generator<infer R>
    ? AsyncGenerator<R>
    : T extends Promise<infer R>
    ? Promise<R>
    : Promise<T>;

/**
 * `AsyncDetail<T>` is similar to {@link Async} except it maps retun values R to
 * `Detail<R>`, which is the return value with additional information about each
 * cloud function invocation.
 * @public
 */
export type AsyncDetail<T> = T extends AsyncGenerator<infer R>
    ? AsyncGenerator<Detail<R>>
    : T extends Generator<infer R>
    ? AsyncGenerator<Detail<R>>
    : T extends Promise<infer R>
    ? Promise<Detail<R>>
    : Promise<Detail<T>>;

/**
 * `ProxyModule<M>` is the type of {@link FaastModule.functions}.
 * @remarks
 * `ProxyModule<M>` maps an imported module's functions to promise-returning or
 * async-iteratable versions of those functions. Non-function exports of the
 * module are omitted. When invoked, the functions in a `ProxyModule` invoke a
 * remote cloud function.
 * @public
 */
export type ProxyModule<M> = {
    [K in keyof M]: M[K] extends (...args: infer A) => infer R
        ? (...args: A) => Async<R>
        : never;
};

/**
 * Similar to {@link ProxyModule} except each function returns a {@link Detail}
 * object.
 * @remarks
 * See {@link FaastModule.functionsDetail}.
 * @public
 */
export type ProxyModuleDetail<M> = {
    [K in keyof M]: M[K] extends (...args: infer A) => infer R
        ? (...args: A) => AsyncDetail<R>
        : never;
};

/**
 * A function return value with additional detailed information.
 * @public
 */
export interface Detail<R> {
    /**
     * A Promise for the function's return value.
     */
    value: R;
    /**
     * The URL of the logs for the specific execution of this function call.
     * @remarks
     * This is different from the general logUrl from
     * {@link FaastModule.logUrl}, which provides a link to the logs for all
     * invocations of all functions within that module. Whereas this logUrl is
     * only for this specific invocation.
     */
    logUrl?: string;
    /**
     * If available, the provider-specific execution identifier for this
     * invocation.
     * @remarks
     * This ID may be added to the log entries for this invocation by the cloud
     * provider.
     */
    executionId?: string;
    /**
     * If available, the provider-specific instance identifier for this
     * invocation.
     * @remarks
     * This ID refers to the specific container or VM used to execute this
     * function invocation. The instance may be reused across multiple
     * invocations.
     */
    instanceId?: string;
}

interface FunctionReturnWithMetrics {
    response: PromiseResponseMessage | IteratorResponseMessage;
    value: any;
    localRequestSentTime: number;
    localEndTime: number;
    remoteResponseSentTime?: number;
}

async function createFaastModuleProxy<M extends object, O extends CommonOptions, S>(
    impl: ProviderImpl<O, S>,
    fmodule: M,
    userOptions?: O
): Promise<FaastModuleProxy<M, O, S>> {
    try {
        const resolvedModule = resolve(fmodule);
        const functionId = uuidv4() as UUID;
        const options: Required<O> = { ...impl.defaults, ...userOptions };
        log.provider(`options ${inspectProvider(options)}`);
        return new FaastModuleProxy(
            impl,
            await impl.initialize(resolvedModule, functionId, options),
            fmodule,
            resolvedModule,
            options as Required<CommonOptions>
        );
    } catch (err: any) {
        throw new FaastError(err, "could not initialize cloud function");
    }
}

/**
 * Summarize statistics about cloud function invocations.
 * @public
 */
export class FunctionStatsEvent {
    /**
     * @internal
     */
    constructor(
        /** The name of the cloud function the statistics are about. */
        readonly fn: string,
        /** See {@link FunctionStats}. */
        readonly stats: FunctionStats
    ) {
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

class PendingRequest {
    queue: AsyncOrderedQueue<FunctionReturnWithMetrics> = new AsyncOrderedQueue();
    created: number = Date.now();
    executing?: boolean;

    constructor(readonly call: FunctionCall) {}
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
     * to a {@link ProxyModule} version of the module, which performs the
     * following mapping:
     *
     * - All function exports that are generators are mapped to async
     *   generators.
     *
     * - All function exports that return async generators are preserved as-is.
     *
     * - All function exports that return promises have their type signatures
     *   preserved as-is.
     *
     * - All function exports that return type T, where T is not a Promise,
     *   Generator, or AsyncGenerator, are mapped to functions that return
     *   Promise<T>. Argument types are preserved as-is.
     *
     * - All non-function exports are omitted in the remote module.
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
     * - AWS: 256KB in queue mode, 6MB arguments and 256KB return values in https mode. See
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
    functions: ProxyModule<M>;
    /**
     * Similar to {@link FaastModule.functions} except each function returns a
     * {@link Detail} object
     * @remarks
     * Advanced users of faast.js may want more information about each function
     * invocation than simply the result of the function call. For example, the
     * specific logUrl for each invocation, to help with detailed debugging.
     * This interface provides a way to get this detailed information.
     */
    functionsDetail: ProxyModuleDetail<M>;
    /**
     * Stop the faast.js runtime for this cloud function and clean up ephemeral
     * cloud resources.
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
    /** The {@link Provider}, e.g. "aws" or "google". */
    provider = this.impl.name;
    /** {@inheritdoc FaastModule.functions} */
    functions: ProxyModule<M>;
    /** {@inheritdoc FaastModule.functionsDetail} */
    functionsDetail: ProxyModuleDetail<M>;
    /** @internal */
    private _stats = new FunctionStatsMap();
    private _cpuUsage = new FactoryMap(
        () => new FactoryMap((_: number) => new FunctionCpuUsage())
    );
    private _memoryLeakDetector: MemoryLeakDetector;
    private _funnel: Funnel<any>;
    private _rateLimiter?: RateLimiter<any>;
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
        /** @internal */
        readonly state: S,
        private fmodule: M,
        private modulePath: string,
        /** The options set for this instance, which includes default values. */
        readonly options: Required<CommonOptions>
    ) {
        log.info(`Node version: ${process.version}`);
        log.provider(`name: ${this.impl.name}`);
        log.provider(`responseQueueId: ${this.impl.responseQueueId(state)}`);
        log.provider(`logUrl: ${this.impl.logUrl(state)}`);
        log.info(`Log url: ${impl.logUrl(state)}`);

        this._funnel = new Funnel<any>(options.concurrency);
        if (options.rate) {
            this._rateLimiter = new RateLimiter(options.rate, 1);
        }
        this._memoryLeakDetector = new MemoryLeakDetector(options.memorySize);
        const functionsDetail: any = {};
        const functions: any = {};
        for (const name of Object.keys(fmodule)) {
            const origFunction = (fmodule as any)[name];
            if (typeof origFunction === "function") {
                if (isGenerator(origFunction)) {
                    const func = this.wrapGenerator(origFunction);
                    functionsDetail[name] = func;
                    functions[name] = async function* (...args: any[]) {
                        const generator = func(...args);
                        for await (const iter of generator) {
                            yield iter.value;
                        }
                    };
                } else {
                    const func = this.wrapFunction(origFunction);
                    functionsDetail[name] = func;
                    functions[name] = (...args: any[]) =>
                        func(...args).then(p => p.value);
                }
            }
        }
        this.functions = functions;
        this.functionsDetail = functionsDetail;
        this._collectorPump = new Pump({ concurrency: 2 }, () => this.resultCollector());
        this._collectorPump.start();
    }

    /** {@inheritdoc FaastModule.cleanup} */
    async cleanup(userCleanupOptions: CleanupOptions = {}) {
        try {
            this._stats.clear();
            this._memoryLeakDetector.clear();
            this._funnel.clear();
            this._rateLimiter?.clear();
            this._cleanupHooks.forEach(hook => hook.resolve());
            this._cleanupHooks.clear();
            this._emitter.removeAllListeners();
            this.stopStats();
            this._initialInvocationTime.clear();
            this._callResultsPending.clear();
            this._collectorPump.stop();
            log.provider(`cleanup`);
            const options = { ...CleanupOptionDefaults, ...userCleanupOptions };
            const { gcTimeout } = options;
            let timedout = false;
            if (gcTimeout > 0) {
                const timeout = sleep(gcTimeout * 1000).then(() => (timedout = true));
                await Promise.race([this.impl.cleanup(this.state, options), timeout]);
            } else {
                await this.impl.cleanup(this.state, options);
            }
            if (timedout) {
                log.provider(`cleanup timed out after ${gcTimeout}s`);
            } else {
                log.provider(`cleanup done`);
            }
        } catch (err: any) {
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

    private processResponse<R>(
        returned: FunctionReturnWithMetrics,
        functionName: string,
        localStartTime: number
    ): Promise<Detail<R>> {
        const { response } = returned;
        const { logUrl, instanceId, memoryUsage } = response;
        let value: Promise<Detail<R>>;

        if (response.type === "reject") {
            const error = response.isErrorObject
                ? synthesizeFaastError({
                      errObj: returned.value,
                      logUrl: ` ${logUrl} `,
                      functionName
                  })
                : returned.value;
            value = Promise.reject(error);
            value.catch((_silenceWarningLackOfSynchronousCatch: any) => {});
        } else {
            const { executionId } = returned.response;
            const detail = {
                value: returned.value[0],
                logUrl,
                executionId,
                instanceId,
                memoryUsage
            };
            value = Promise.resolve(detail);
        }
        const { localRequestSentTime, remoteResponseSentTime, localEndTime } = returned;
        const { remoteExecutionStartTime, remoteExecutionEndTime } = response;
        const fstats = this._stats;
        if (remoteExecutionStartTime && remoteExecutionEndTime) {
            const localStartLatency = localRequestSentTime - localStartTime;
            const roundTripLatency = localEndTime - localRequestSentTime;
            const executionTime = remoteExecutionEndTime - remoteExecutionStartTime;
            const sendResponseLatency = Math.max(
                0,
                (remoteResponseSentTime || remoteExecutionEndTime) -
                    remoteExecutionEndTime
            );
            const networkLatency = roundTripLatency - executionTime - sendResponseLatency;
            const estimatedRemoteStartTime = localRequestSentTime + networkLatency / 2;
            const estimatedSkew = estimatedRemoteStartTime - remoteExecutionStartTime;
            let skew = estimatedSkew;
            if (fstats.aggregate.completed > 1) {
                this._skew.update(skew);
                skew = this._skew.value;
            }

            const remoteStartLatency = Math.max(
                1,
                remoteExecutionStartTime + skew - localRequestSentTime
            );
            const returnLatency = Math.max(
                1,
                localEndTime - (remoteExecutionEndTime + skew)
            );
            fstats.update(functionName, "localStartLatency", localStartLatency);
            fstats.update(functionName, "remoteStartLatency", remoteStartLatency);
            fstats.update(functionName, "executionTime", executionTime);
            fstats.update(functionName, "sendResponseLatency", sendResponseLatency);
            fstats.update(functionName, "returnLatency", returnLatency);

            const billed = (executionTime || 0) + (sendResponseLatency || 0);
            const estimatedBilledTime = Math.max(100, Math.ceil(billed / 100) * 100);
            fstats.update(functionName, "estimatedBilledTime", estimatedBilledTime);
        }

        if (response.type === "reject") {
            fstats.incr(functionName, "errors");
        } else {
            fstats.incr(functionName, "completed");
        }

        if (instanceId && memoryUsage) {
            if (
                this._memoryLeakDetector.detectedNewLeak(
                    functionName,
                    instanceId,
                    memoryUsage
                )
            ) {
                log.leaks(`Possible memory leak detected in function '${functionName}'.`);
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
        return value;
    }

    private invoke(fname: string, args: any[], callId: string) {
        const ResponseQueueId = this.impl.responseQueueId(this.state);
        const callObject: FunctionCall = {
            name: fname,
            args: serializeFunctionArgs(fname, args, this.options.validateSerialization),
            callId,
            modulePath: this.modulePath,
            ResponseQueueId
        };

        log.calls(`Calling '${fname}' (${callId})`);
        const pending = new PendingRequest(callObject);
        this._callResultsPending.set(callId, pending);
        if (this._collectorPump.stopped) {
            this._collectorPump.start();
        }

        this.withCancellation(async cancel => {
            await this.impl.invoke(this.state, pending.call, cancel).catch(err =>
                pending.queue.pushImmediate({
                    response: {
                        kind: "promise",
                        type: "reject",
                        callId,
                        isErrorObject: typeof err === "object" && err instanceof Error,
                        value: serialize(err)
                    },
                    value: err,
                    localEndTime: Date.now(),
                    localRequestSentTime: pending.created
                })
            );
        });
        return pending;
    }

    private lookupFname(fn: Function) {
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
        return fname;
    }

    private createCallId() {
        return uuidv4();
    }

    private wrapGenerator<A extends any[], R>(
        fn: ((...args: A) => AsyncGenerator<R>) | ((...args: A) => Generator<R>)
    ): (...args: A) => AsyncIterableIterator<Detail<R>> {
        return (...args: A) => {
            const startTime = Date.now();
            let fname = this.lookupFname(fn);
            const callId = this.createCallId();
            const pending = this.invoke(fname, args, callId);
            log.provider(`invoke ${inspectProvider(pending.call)}`);
            this._stats.incr(fname, "invocations");
            return {
                [Symbol.asyncIterator]() {
                    return this;
                },
                next: () =>
                    pending.queue.next().then(async next => {
                        const promise = this.processResponse<IteratorYieldResult<R>>(
                            next,
                            fname,
                            startTime
                        );
                        const result = await promise;
                        log.calls(`yielded ${inspect(result)}`);
                        const { value, ...rest } = result;
                        if (result.value.done) {
                            this.clearPending(callId);
                            return { done: true, value: rest };
                        } else {
                            return {
                                done: false,
                                value: { ...rest, value: value.value }
                            };
                        }
                    })
            };
        };
    }

    private clearPending(callId: string) {
        this._callResultsPending.delete(callId);
        if (this._callResultsPending.size === 0) {
            this._collectorPump.stop();
        }
    }

    private wrapFunction<A extends any[], R>(
        fn: (...args: A) => R
    ): (...args: A) => Async<Detail<R>> {
        return (...args: A) => {
            const startTime = Date.now();
            let fname = this.lookupFname(fn);
            const callId = this.createCallId();
            const tryInvoke = async () => {
                const pending = this.invoke(fname, args, callId);
                log.provider(`invoke ${inspectProvider(pending.call)}`);
                this._stats.incr(fname, "invocations");
                const responsePromise = pending.queue.next();
                const rv = await responsePromise;
                this.clearPending(callId);
                log.calls(`Returning '${fname}' (${callId}): ${inspect(rv)}`);
                return this.processResponse<R>(rv, fname, startTime);
            };

            const funnel = this._funnel;

            let retries = 0;
            const shouldRetry = (err: any) => {
                if (err instanceof FaastError) {
                    if (FaastError.hasCauseWithName(err, FaastErrorNames.ESERIALIZE)) {
                        return false;
                    }
                    // Don't retry user-generated errors. Only errors caused by
                    // failures of operations faast itself initiated (e.g. cloud
                    // service APIs) are retried.
                    if (FaastError.hasCauseWithName(err, FaastErrorNames.EEXCEPTION)) {
                        return false;
                    }
                }
                if (retries < this.options.maxRetries) {
                    retries++;
                    this._stats.incr(fname, "retries");
                    log.info(
                        `faast: func: ${fname} attempts: ${retries}, err: ${inspectProvider(
                            err
                        )}`
                    );
                    return true;
                }
                return false;
            };

            if (this._rateLimiter) {
                return funnel.push(
                    () => this._rateLimiter!.push(tryInvoke),
                    shouldRetry
                ) as Async<Detail<R>>;
            } else {
                return funnel.push(tryInvoke, shouldRetry) as Async<Detail<R>>;
            }
        };
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
                case "functionstarted": {
                    const pending = callResultsPending.get(m.callId);
                    if (pending) {
                        pending!.executing = true;
                    }
                    break;
                }
                case "promise":
                case "iterator":
                    try {
                        const { timestamp } = m;
                        const value = deserialize(m.value);
                        const pending = callResultsPending.get(m.callId);
                        if (pending) {
                            const rv: FunctionReturnWithMetrics = {
                                response: m,
                                value,
                                remoteResponseSentTime: timestamp,
                                localRequestSentTime: pending.created,
                                localEndTime
                            };
                            log.provider(`returned ${inspectProvider(value)}`);
                            if (m.kind === "iterator") {
                                pending.queue.push(rv, m.sequence);
                            } else {
                                pending.queue.pushImmediate(rv);
                            }
                        } else {
                            log.info(`Pending promise not found for CallId: ${m.callId}`);
                        }
                    } catch (err: any) {
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

function resolve(fmodule: object | { FAAST_URL: string }) {
    if ("FAAST_URL" in fmodule) {
        const url = fmodule["FAAST_URL"];
        if (typeof url !== "string") {
            throw new FaastError(
                { info: { module: fmodule } },
                `FAAST_URL must be a string.`
            );
        }
        return fileURLToPath(url);
    }
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
            { info: { module: fmodule } },
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
 * (async () => {
 *     const faastModule = await faast("aws", mod);
 *     try {
 *         const result = await faastModule.functions.func("arg");
 *     } finally {
 *         await faastModule.cleanup();
 *     }
 * })();
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
    const { executionTime, localStartLatency, remoteStartLatency, returnLatency } =
        fnStats;

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
