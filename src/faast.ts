import * as path from "path";
import * as util from "util";
import * as uuidv4 from "uuid/v4";
import * as aws from "./aws/aws-faast";
import * as costAnalyzer from "./cost";
import * as google from "./google/google-faast";
import * as local from "./local/local-faast";
import { info, logCalls, logLeaks, stats, warn } from "./log";
import { PackerResult } from "./packer";
import {
    ExponentiallyDecayingAverageValue,
    FactoryMap,
    roundTo100ms,
    sleep,
    Statistics
} from "./shared";
import { Deferred, Funnel } from "./throttle";
import { NonFunctionProperties, Unpacked } from "./types";
import { FunctionCall, FunctionReturn, FunctionReturnWithMetrics } from "./wrapper";
import Module = require("module");
import { PackerOptions, CommonOptions, CommonOptionDefaults } from "./options";
import { EventEmitter } from "events";

export { aws, google, local, costAnalyzer };

export class FaastError extends Error {
    logUrl?: string;
    constructor(errObj: any, logUrl?: string) {
        let message = errObj.message;
        if (logUrl) {
            message += `\n(logs: ${logUrl})`;
        }
        super(message);
        if (Object.keys(errObj).length === 0 && !(errObj instanceof Error)) {
            warn(
                `Error response object has no keys, likely a bug in faast (not serializing error objects)`
            );
        }
        this.logUrl = logUrl;
        this.name = errObj.name;
        this.stack = errObj.stack;
    }
}

export interface ResponseDetails<D> {
    value: Promise<D>;
    rawResponse: any;
    executionId?: string;
    logUrl?: string;
    localStartLatency?: number;
    remoteStartLatency?: number;
    executionLatency?: number;
    sendResponseLatency?: number;
    returnLatency?: number;
}

export type Response<D> = ResponseDetails<Unpacked<D>>;

export type PromisifiedFunction<A extends any[], R> = (
    ...args: A
) => Promise<Unpacked<R>>;

export type Promisified<M> = {
    [K in keyof M]: M[K] extends (...args: infer A) => infer R
        ? PromisifiedFunction<A, R>
        : never
};

export type ResponsifiedFunction<A extends any[], R> = (
    ...args: A
) => Promise<Response<R>>;

export type Responsified<M> = {
    [K in keyof M]: M[K] extends (...args: infer A) => infer R
        ? ResponsifiedFunction<A, R>
        : never
};

function resolveModule(fmodule: string) {
    const parent = module.parent!;
    if (parent.filename.match(/aws-faast/)) {
        info(
            `WARNING: import faast before aws-faast to avoid problems with module resolution`
        );
    }
    if (path.isAbsolute(fmodule)) {
        return fmodule;
    }
    return (Module as any)._resolveFilename(fmodule, module.parent);
}

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
            .map(key => `${key}: ${this[key]}`)
            .join(", ");
    }
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
}

export class FunctionInstanceStats {
    rss = new Statistics();
    heapTotal = new Statistics();
    heapUsed = new Statistics();
    external = new Statistics();
}

export class FunctionInstanceCounters {
    heapUsedGrowth = 0;
    externalGrowth = 0;
}

export class MemoryLeakDetector {
    protected instances = new FactoryMap(() => new FunctionInstanceStats());
    protected counters = new FactoryMap(() => new FunctionInstanceCounters());
    protected warned = new Set<string>();
    protected memorySize: number;

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
}

function processResponse<R>(
    returnedMetrics: FunctionReturnWithMetrics,
    callRequest: FunctionCall,
    localStartTime: number,
    fcounters: FunctionCountersMap,
    fstats: FunctionStatsMap,
    prevSkew: ExponentiallyDecayingAverageValue,
    memoryLeakDetector: MemoryLeakDetector
) {
    const returned = returnedMetrics.returned;
    const { executionId, logUrl, instanceId, memoryUsage } = returned;
    let value: Promise<Unpacked<R>>;
    if (returned.type === "error") {
        let error = returned.value;
        if (returned.isErrorObject) {
            error = new FaastError(returned.value, logUrl);
        }
        value = Promise.reject(error);
        value.catch(_ => {});
    } else {
        value = Promise.resolve(returned.value);
    }
    const {
        localRequestSentTime,
        remoteResponseSentTime,
        localEndTime,
        rawResponse
    } = returnedMetrics;
    let rv: Response<R> = {
        value,
        executionId,
        logUrl,
        rawResponse
    };
    const fn = callRequest.name;
    const { remoteExecutionStartTime, remoteExecutionEndTime } = returnedMetrics.returned;

    if (remoteExecutionStartTime && remoteExecutionEndTime) {
        const localStartLatency = localRequestSentTime - localStartTime;
        const roundTripLatency = localEndTime - localRequestSentTime;
        const executionLatency = remoteExecutionEndTime - remoteExecutionStartTime;
        const sendResponseLatency = Math.max(
            0,
            (remoteResponseSentTime || remoteExecutionEndTime) - remoteExecutionEndTime
        );
        const networkLatency = roundTripLatency - executionLatency - sendResponseLatency;
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
        fstats.update(fn, "executionLatency", executionLatency);
        fstats.update(fn, "sendResponseLatency", sendResponseLatency);
        fstats.update(fn, "returnLatency", returnLatency);

        const billed = (executionLatency || 0) + (sendResponseLatency || 0);
        const estimatedBilledTime = Math.max(100, Math.ceil(billed / 100) * 100);
        fstats.update(fn, "estimatedBilledTime", estimatedBilledTime);
        rv = {
            ...rv,
            localStartLatency,
            remoteStartLatency,
            executionLatency,
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
            logLeaks(`Possible memory leak detected in function '${fn}'.`);
            logLeaks(
                `Memory use before execution leaked from prior calls: %O`,
                memoryUsage
            );
            logLeaks(`Logs: ${logUrl}`);
            logLeaks(
                `These logs show only one example faast function invocation that may have a leak.`
            );
        }
    }

    return rv;
}

export async function createFunction<M extends object, O extends CommonOptions, S>(
    fmodule: M,
    modulePath: string,
    impl: CloudFunctionImpl<O, S>,
    options?: O
): Promise<CloudFunction<M, O, S>> {
    const resolvedModule = resolveModule(modulePath);
    const functionId = uuidv4();
    return new CloudFunction(
        impl,
        await impl.initialize(resolvedModule, functionId, options),
        fmodule,
        resolvedModule,
        options
    );
}

export class FunctionStatsEvent {
    constructor(
        readonly fn: string,
        readonly counters: FunctionCounters,
        readonly stats?: FunctionStats
    ) {}

    toString() {
        const executionLatency = this.stats ? this.stats.executionLatency.mean : 0;
        return `[${this.fn}] ${this.counters}, executionLatency: ${(
            executionLatency / 1000
        ).toFixed(2)}s`;
    }
}

export class CloudFunction<
    M extends object,
    O extends CommonOptions = CommonOptions,
    S = any
> extends EventEmitter {
    cloudName = this.impl.name;
    functionCounters = new FunctionCountersMap();
    functionStats = new FunctionStatsMap();
    functions: Promisified<M>;
    protected memoryLeakDetector: MemoryLeakDetector;
    protected funnel: Funnel<any>;
    protected memorySize: number | undefined;
    protected timeout: number | undefined;
    protected skew = new ExponentiallyDecayingAverageValue(0.3);
    protected statsTimer?: NodeJS.Timer;
    protected cleanupHooks: Set<() => void> = new Set();
    protected initialInvocationTime = new FactoryMap(() => Date.now());
    protected maxRetries = CommonOptionDefaults.maxRetries;
    protected tailLatencyRetryStdev = CommonOptionDefaults.speculativeRetryThreshold;
    protected childProcess = CommonOptionDefaults.childProcess;

    get defaults() {
        return this.impl.defaults;
    }

    constructor(
        protected impl: CloudFunctionImpl<O, S>,
        readonly state: S,
        readonly fmodule: M,
        readonly modulePath: string,
        readonly options?: O
    ) {
        super();
        info(`Node version: ${process.version}`);

        let concurrency = (options && options.concurrency) || impl.defaults.concurrency;
        if (!concurrency) {
            warn(
                `Default concurrency level not defined for cloud type '${
                    impl.name
                }', defaulting to 1`
            );
            concurrency = 1;
        }
        this.funnel = new Funnel<any>(concurrency);
        this.memorySize = (options && options.memorySize) || impl.defaults.memorySize!;
        this.timeout = (options && options.timeout) || impl.defaults.timeout;
        this.memoryLeakDetector = new MemoryLeakDetector(this.memorySize);
        if (options && options.maxRetries !== undefined) {
            this.maxRetries = options.maxRetries;
        }
        if (options && options.speculativeRetryThreshold !== undefined) {
            this.tailLatencyRetryStdev = Math.max(0, options.speculativeRetryThreshold);
        }
        if (options && options.childProcess !== undefined) {
            this.childProcess = options.childProcess;
        }

        info(`Log url: ${impl.logUrl(state)}`);
        const functions: any = {};
        for (const name of Object.keys(fmodule)) {
            if (typeof fmodule[name] === "function") {
                functions[name] = this.wrapFunction(fmodule[name]);
            }
        }
        this.functions = functions;
    }

    async cleanup() {
        this.funnel.clear();
        this.cleanupHooks.forEach(hook => hook());
        this.cleanupHooks.clear();
        this.stopStats();
        return this.impl.cleanup(this.state);
    }

    stop() {
        this.funnel.clear();
        this.cleanupHooks.forEach(hook => hook());
        this.cleanupHooks.clear();
        this.stopStats();
        return this.impl.stop(this.state);
    }

    logUrl() {
        return this.impl.logUrl(this.state);
    }

    startStats(interval: number = 1000) {
        this.statsTimer = setInterval(() => {
            this.functionCounters.fIncremental.forEach((counters, fn) => {
                const stats = this.functionStats.fIncremental.get(fn);
                this.emit("stats", new FunctionStatsEvent(fn, counters, stats));
            });

            this.functionCounters.resetIncremental();
            this.functionStats.resetIncremental();
        }, interval);
    }

    stopStats() {
        this.statsTimer && clearInterval(this.statsTimer);
        this.statsTimer = undefined;
    }

    on(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void) {
        return super.on(name, listener);
    }

    wrapFunctionWithResponse<A extends any[], R>(
        fn: (...args: A) => R
    ): ResponsifiedFunction<A, R> {
        return async (...args: A) => {
            let retries = 0;
            const startTime = Date.now();
            const initialInvocationTime = this.initialInvocationTime.getOrCreate(fn.name);
            // XXX capture google retries in stats?

            const shouldRetry = () => {
                if (retries < this.maxRetries) {
                    retries++;
                    this.functionCounters.incr(fn.name, "retries");
                    return true;
                }
                return false;
            };

            const invoke = async () => {
                const CallId = uuidv4();
                logCalls(`Calling '${fn.name}' (${CallId})`);
                const deferred = new Deferred<FunctionReturnWithMetrics>();
                const callRequest: FunctionCall = {
                    name: fn.name,
                    args,
                    CallId,
                    modulePath: this.modulePath
                };

                const invokeCloudFunction = () => {
                    this.functionCounters.incr(fn.name, "invocations");
                    return this.impl
                        .callFunction(this.state, callRequest)
                        .catch(value => {
                            const returned: FunctionReturn = {
                                type: "error",
                                value,
                                CallId
                            };
                            return {
                                returned,
                                rawResponse: {},
                                localRequestSentTime: startTime,
                                localEndTime: Date.now()
                            };
                        })
                        .then(deferred.resolve);
                };

                const fnStats = this.functionStats.fAggregate.getOrCreate(fn.name);

                const addHook = (f: () => void) => this.cleanupHooks.add(f);
                const clearHook = (f: () => void) => this.cleanupHooks.delete(f);

                retryFunctionIfNeededToReduceTailLatency(
                    () => Date.now() - initialInvocationTime,
                    () =>
                        Math.max(
                            estimateTailLatency(fnStats, this.tailLatencyRetryStdev),
                            5000
                        ),
                    invokeCloudFunction,
                    shouldRetry,
                    ms => sleep(ms, addHook).then(clearHook)
                );

                const rv = await deferred.promise;

                logCalls(
                    `Returning '${fn.name}' (${CallId}): ${util.inspect(rv.returned)}`
                );

                return processResponse<R>(
                    rv,
                    callRequest,
                    startTime,
                    this.functionCounters,
                    this.functionStats,
                    this.skew,
                    this.memoryLeakDetector
                );
            };

            return this.funnel.push(invoke, shouldRetry);
        };
    }

    wrapFunction<A extends any[], R>(fn: (...args: A) => R): PromisifiedFunction<A, R> {
        const wrappedFunc = (...args: A) => {
            const cfn = this.wrapFunctionWithResponse(fn);
            const promise = cfn(...args).then(response => response.value);
            promise.catch(_ => {});
            return promise;
        };
        return wrappedFunc as any;
    }

    async costEstimate() {
        if (this.impl.costEstimate) {
            const estimate = await this.impl.costEstimate(
                this.state,
                this.functionCounters.aggregate,
                this.functionStats.aggregate
            );
            if (this.functionCounters.aggregate.retries > 0) {
                const { retries, invocations } = this.functionCounters.aggregate;
                const retryPct = ((retries / invocations) * 100).toFixed(1);
                estimate.push(
                    new costAnalyzer.CostMetric({
                        name: "retries",
                        pricing: 0,
                        measured: retries,
                        unit: "retry",
                        unitPlural: "retries",
                        comment: `Retries were ${retryPct}% of requests and may have incurred charges not accounted for by faast.`,
                        alwaysZero: true
                    })
                );
            }
            return estimate;
        } else {
            return new costAnalyzer.CostBreakdown();
        }
    }
}

export type AnyCloudFunction = CloudFunction<any, any, any>;

export class AWSLambda<M extends object = object> extends CloudFunction<
    M,
    aws.Options,
    aws.State
> {}

export class GoogleCloudFunction<M extends object = object> extends CloudFunction<
    M,
    google.Options,
    google.State
> {}

export class LocalFunction<M extends object = object> extends CloudFunction<
    M,
    local.Options,
    local.State
> {}

export type CloudProvider = "aws" | "google" | "google-emulator" | "local";

export function faastify<M extends object>(
    cloudName: "aws",
    fmodule: M,
    modulePath: string,
    options?: aws.Options
): Promise<CloudFunction<M, aws.Options, aws.State>>;
export function faastify<M extends object>(
    cloudName: "google" | "google-emulator",
    fmodule: M,
    modulePath: string,
    options?: google.Options
): Promise<CloudFunction<M, google.Options, google.State>>;
export function faastify<M extends object>(
    cloudName: "local",
    fmodule: M,
    modulePath: string,
    options?: local.Options
): Promise<CloudFunction<M, local.Options, local.State>>;
export function faastify<M extends object, S>(
    cloudName: CloudProvider,
    fmodule: M,
    modulePath: string,
    options?: CommonOptions
): Promise<CloudFunction<M, CommonOptions, S>>;
export async function faastify<M extends object, O extends CommonOptions, S>(
    cloudProvider: CloudProvider,
    fmodule: M,
    modulePath: string,
    options?: O
): Promise<CloudFunction<M, O, S>> {
    let impl: any;
    switch (cloudProvider) {
        case "aws":
            impl = aws.Impl;
            break;
        case "google":
            impl = google.Impl;
            break;
        case "google-emulator":
            impl = google.EmulatorImpl;
            break;
        case "local":
            impl = local.Impl;
            break;
        default:
            throw new Error(`Unknown cloud provider option '${cloudProvider}'`);
    }
    return createFunction<M, O, S>(fmodule, modulePath, impl, options);
}

export interface CloudFunctionImpl<O, S> {
    name: string;
    defaults: O;

    initialize(serverModule: string, functionId: string, options?: O): Promise<S>;

    pack(functionModule: string, options?: PackerOptions): Promise<PackerResult>;

    costEstimate?: (
        state: S,
        counters: FunctionCounters,
        stats: FunctionStats
    ) => Promise<costAnalyzer.CostBreakdown>;

    callFunction(state: S, call: FunctionCall): Promise<FunctionReturnWithMetrics>;

    cleanup(state: S): Promise<void>;
    stop(state: S): Promise<void>;
    logUrl(state: S): string;
}

export interface LogEntry {
    timestamp: number;
    message: string;
}

function estimateFunctionLatency(fnStats: FunctionStats) {
    const {
        executionLatency,
        localStartLatency,
        remoteStartLatency,
        returnLatency
    } = fnStats;

    return (
        localStartLatency.mean +
            remoteStartLatency.mean +
            executionLatency.mean +
            returnLatency.mean || 0
    );
}

function estimateTailLatency(fnStats: FunctionStats, nStdDev: number) {
    return estimateFunctionLatency(fnStats) + nStdDev * fnStats.executionLatency.stdev;
}

async function retryFunctionIfNeededToReduceTailLatency(
    timeSinceInitialInvocation: () => number,
    getTimeout: () => number,
    worker: () => Promise<void>,
    shouldRetry: () => boolean,
    wait: (ms: number) => Promise<unknown>
) {
    let pending = true;
    let lastInvocationTime: number = Date.now();

    const doWork = async () => {
        lastInvocationTime = Date.now();
        await worker();
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
        await wait(waitTime);
    }
}
