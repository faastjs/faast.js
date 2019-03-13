import { EventEmitter } from "events";
import * as path from "path";
import * as util from "util";
import * as uuidv4 from "uuid/v4";
import { _parentModule } from "../index";
import { AwsOptions, AwsState, AwsImpl } from "./aws/aws-faast";
import { CostMetric, CostSnapshot } from "./cost";
import { GoogleOptions, GoogleState, GoogleImpl } from "./google/google-faast";
import { LocalOptions, LocalState, LocalImpl } from "./local/local-faast";
import { inspectProvider, log } from "./log";
import {
    CallId,
    CleanupOptionDefaults,
    CleanupOptions,
    CloudFunctionImpl,
    FunctionCounters,
    FunctionStats,
    Invocation,
    UUID,
    Provider,
    CommonOptions
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
import { CpuMeasurement, FunctionCall, FunctionReturn } from "./wrapper";
import Module = require("module");
import { dirname } from "path";
import { serializeCall, FaastSerializationError } from "./serialize";

/**
 * @public
 */
export const providers: Provider[] = ["aws", "google", "local"];

/**
 * Error type returned by cloud functions when they reject their promises with
 * an instance of Error or any object.
 * @remarks
 * When a faast.js cloud function throws an exception or rejects the promise it
 * returns with an instance of Error or any object, that error is returned as a
 * `FaastError` on the local side. The original error type is not used.
 * `FaastError` copies the properties of the original error and adds them to
 * FaastError.
 *
 * If available, a log URL for the specific invocation that caused the error is
 * appended to the log message. This log URL is also available as the `logUrl`
 * property. It will be surrounded by whilespace on both sides to ease parsing
 * as a URL by IDEs.
 *
 * Stack traces and error names should be preserved from the cloud side.
 * @public
 */
export class FaastError extends Error {
    /** The log URL for the specific invocation that caused this error. */
    logUrl?: string;

    /** @internal */
    constructor(errObj: any, logUrl?: string) {
        super("");
        Object.assign(this, errObj);
        let message = errObj.message;
        if (logUrl) {
            message += `\nlogs: ${logUrl} `;
        }
        this.message = message;
        if (Object.keys(errObj).length === 0 && !(errObj instanceof Error)) {
            log.warn(
                `Error response object has no keys, likely a bug in faast (not serializing error objects)`
            );
        }
        // Surround the logUrl with spaces because URL links are broken in
        // vscode if there's no whitespace surrounding the URL.
        this.logUrl = ` ${logUrl} `;
        this.name = errObj.name;
        this.stack = errObj.stack;
    }

    /** Additional properties from the remotely thrown Error. */
    [key: string]: any;
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
 * Given argument types A and return type R of a function,
 * PromisifiedFunction<A,R> is a type with the same signature except the return
 * value is replaced with a Promise. If the original function already returned a
 * promise, the signature is unchanged. This is used by {@link Promisified}.
 * @public
 */
export type PromisifiedFunction<A extends any[], R> = (
    ...args: A
) => Promise<Unpacked<R>>;

/**
 * Promisified<M> is the type of {@link CloudFunction.functions}. It maps an
 * imported module's functions to promise-returning versions of those functions
 * (see {@link PromisifiedFunction}). Non-function exports of the module are
 * omitted.
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

async function createCloudFunction<M extends object, O extends CommonOptions, S>(
    impl: CloudFunctionImpl<O, S>,
    fmodule: M,
    modulePath: string,
    userOptions?: O
): Promise<CloudFunctionWrapper<M, O, S>> {
    try {
        const resolvedModule = resolveModule(modulePath);
        const functionId = uuidv4() as UUID;
        const options = Object.assign({}, impl.defaults, userOptions);
        log.provider(`options ${inspectProvider(options)}`);
        return new CloudFunctionWrapper(
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
        log.warn(`faast: createFunction error: ${err}`);
        throw err;
    }
}

/**
 * Summarize statistics about cloud function invocations.
 * @public
 */
export class FunctionStatsEvent {
    readonly counters: FunctionCounters;
    readonly stats?: FunctionStats;
    /**
     * @param fn - The name of the cloud function the statistics are about.
     * @param counters - See {@link FunctionCounters}
     * @param stats - See {@link FunctionStats}
     */
    constructor(readonly fn: string, counters: FunctionCounters, stats?: FunctionStats) {
        this.counters = counters.clone();
        this.stats = stats && stats.clone();
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
 * The main interface for invoking, cleaning up, and managing faast.js cloud
 * functions.
 * @public
 */
export interface CloudFunction<M extends object> {
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
     * @param options - See {@link @CleanupOptions}.
     * @returns a Promise that resolves when the CloudFunction runtime stops and
     * ephemeral resources have been deleted.
     * @remarks
     * It is best practice to always call `cleanup` when done with a cloud
     * function. A typical way to ensure this in normal execution is to use the
     * `finally` construct:
     *
     * ```typescript
     * const cloudFunc = await faast("aws", m, "./path/to/module");
     * try {
     *     // Call cloudFunc.functions.*
     * } finally {
     *     // Note the `await`
     *     await cloudFunc.cleanup();
     * }
     * ```
     *
     * After the cleanup promise resolves, the cloud function instance can no
     * longer invoke new calls on {@link CloudFunction.functions}. However,
     * other methods on {@link CloudFunction} are safe to call, such as
     * {@link CloudFunction.costSnapshot}.
     *
     * Cleanup also stops statistics events (See {@link CloudFunction.off}).
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
     * cloudFunc.on("stats", console.log);
     * ```
     */
    on(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void): void;
    /**
     * Deregister a callback for statistics events.
     * @remarks
     * Stops the callback listener from receiving future function statistics
     * events. Calling {@link CloudFunction.cleanup} also turns off statistics
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
     * {@link CloudFunction.cleanup}.
     *
     * Code example:
     * ```typescript
     * const cloudFunc = await faast("aws", m, "./path/to/module", options);
     * try {
     *     // invoke cloud functions on cloudFunc.functions.*
     * } finally {
     *      await cloudFunc.cleanup();
     *      const costSnapshot = await cloudFunc.costSnapshot();
     *      console.log(costSnapshot);
     * }
     * ```
     */
    costSnapshot(): Promise<CostSnapshot>;

    // counters: FunctionCountersMap;
    // stats: FunctionStatsMap;
}

/**
 * Implementation of the faast.js runtime.
 * @remarks
 * `CloudFunctionWrapper` provides a unified developer experience for faast.js
 * modules on top of provider-specific runtime APIs. Most users will not create
 * `CloudFunctionWrapper` instances themselves; instead use {@link faast}, or
 * {@link faastAws}, {@link faastGoogle}, or {@link faastLocal}.
 * @public
 */
export class CloudFunctionWrapper<M extends object, O, S> implements CloudFunction<M> {
    provider = this.impl.name;
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

    /** {@inheritdoc CloudFunction} */
    async cleanup(userCleanupOptions: CleanupOptions = {}) {
        try {
            const options = Object.assign({}, CleanupOptionDefaults, userCleanupOptions);
            this.counters.clear();
            this.stats.clear();
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
            log.warn(`faast: cleanup error ${err}`);
            throw err;
        }
    }

    /** {@inheritdoc CloudFunction} */
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

    /** {@inheritdoc CloudFunction} */
    on(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void) {
        if (!this._statsTimer) {
            this.startStats();
        }
        this._emitter.on(name, listener);
    }

    /** {@inheritdoc CloudFunction} */
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
                throw new Error(`Could not find function name`);
            }
            const initialInvocationTime = this._initialInvocationTime.getOrCreate(fname);
            // XXX capture google retries in stats?

            const shouldRetry = (err: any) => {
                if (err instanceof FaastSerializationError) {
                    return false;
                }
                if (retries < this.options.maxRetries) {
                    retries++;
                    this.counters.incr(fname, "retries");
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
                const pending = new PendingRequest(callObject);
                this._callResultsPending.set(callId, pending);

                const invokeCloudFunction = () => {
                    this.counters.incr(fname, "invocations");
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

                const fnStats = this.stats.fAggregate.getOrCreate(fname);

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

    /** {@inheritdoc CloudFunction} */
    async costSnapshot() {
        const estimate = await this.impl.costSnapshot(
            this.state,
            this.counters.aggregate,
            this.stats.aggregate
        );
        log.provider(`costSnapshot returned ${inspectProvider(estimate)}`);
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
 * The return type of {@link faastAws}. See {@link CloudFunctionWrapper}.
 * @public
 */
export type AwsLambda<M extends object = object> = CloudFunctionWrapper<
    M,
    AwsOptions,
    AwsState
>;

/**
 * The return type of {@link faastGoogle}. See {@link CloudFunctionWrapper}.
 * @public
 */
export type GoogleCloudFunction<M extends object = object> = CloudFunctionWrapper<
    M,
    GoogleOptions,
    GoogleState
>;

/**
 * The return type of {@link faastLocal}. See {@link CloudFunctionWrapper}.
 * @public
 */
export type LocalFunction<M extends object = object> = CloudFunctionWrapper<
    M,
    LocalOptions,
    LocalState
>;

/**
 * The main entry point for faast with any provider and only common options.
 * @param fmodule - A module imported with `import * as AAA from "BBB";`. Using
 * `require` also works but loses type information.
 * @param modulePath - The path to the module, as it would be specified to
 * `import` or `require`. It should be the same as `"BBB"` from importing
 * fmodule.
 * @param options - {@link CommonOptions}
 * @public
 */
export async function faast<M extends object>(
    provider: Provider,
    fmodule: M,
    modulePath: string,
    options?: CommonOptions
): Promise<CloudFunction<M>> {
    switch (provider) {
        case "aws":
            return faastAws(fmodule, modulePath, options);
        case "google":
            return faastGoogle(fmodule, modulePath, options);
        case "local":
            return faastLocal(fmodule, modulePath, options);
        default:
            throw new Error(`Unknown cloud provider option '${provider}'`);
    }
}

/**
 * The main entry point for faast with AWS provider.
 * @param fmodule - A module imported with `import * as AAA from "BBB";`. Using
 * `require` also works but loses type information.
 * @param modulePath - The path to the module, as it would be specified to
 * `import` or `require`. It should be the same as `"BBB"` from importing
 * fmodule.
 * @param awsOptions - Most common options are in {@link CommonOptions}.
 * Additional AWS-specific options are in {@link AwsOptions}.
 * @public
 */
export function faastAws<M extends object>(
    fmodule: M,
    modulePath: string,
    options?: AwsOptions
): Promise<AwsLambda<M>> {
    return createCloudFunction<M, AwsOptions, AwsState>(
        AwsImpl,
        fmodule,
        modulePath,
        options
    );
}

/**
 * The main entry point for faast with Google provider.
 * @param fmodule - A module imported with `import * as AAA from "BBB";`. Using
 * `require` also works but loses type information.
 * @param modulePath - The path to the module, as it would be specified to
 * `import` or `require`. It should be the same as `"BBB"` from importing
 * fmodule.
 * @param googleOptions - Most common options are in {@link CommonOptions}.
 * Additional Google-specific options are in {@link GoogleOptions}.
 * @public
 */
export function faastGoogle<M extends object>(
    fmodule: M,
    modulePath: string,
    options?: GoogleOptions
): Promise<GoogleCloudFunction<M>> {
    return createCloudFunction<M, GoogleOptions, GoogleState>(
        GoogleImpl,
        fmodule,
        modulePath,
        options
    );
}

/**
 * The main entry point for faast with Local provider.
 * @param fmodule - A module imported with `import * as AAA from "BBB";`. Using
 * `require` also works but loses type information.
 * @param modulePath - The path to the module, as it would be specified to
 * `import` or `require`. It should be the same as `"BBB"` from importing
 * fmodule.
 * @param localOptions - Most common options are in {@link CommonOptions}.
 * Additional Local-specific options are in {@link LocalOptions}.
 * @public
 */
export function faastLocal<M extends object>(
    fmodule: M,
    modulePath: string,
    options?: LocalOptions
): Promise<LocalFunction<M>> {
    return createCloudFunction<M, LocalOptions, LocalState>(
        LocalImpl,
        fmodule,
        modulePath,
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
    secondMap: FunctionCpuUsagePerSecond
) {
    const time = cpuUsage.utime + cpuUsage.stime;
    const rounded = Math.round(elapsed);
    const stats = secondMap.get(rounded);
}
