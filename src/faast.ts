import * as path from "path";
import * as util from "util";
import * as uuidv4 from "uuid/v4";
import * as aws from "./aws/aws-faast";
import * as costAnalyzer from "./cost";
import * as google from "./google/google-faast";
import * as local from "./local/local-faast";
import { info, logCalls, logLeaks, stats, warn } from "./log";
import { PackerOptions, PackerResult } from "./packer";
import {
    assertNever,
    CommonOptionDefaults,
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
    localStartLatency?: number;
    remoteStartLatency?: number;
    executionLatency?: number;
    sendResponseLatency?: number;
    returnLatency?: number;
    executionId?: string;
    logUrl?: string;
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

export interface CommonOptions extends PackerOptions {
    childProcess?: boolean;
    timeout?: number;
    memorySize?: number;
    mode?: "https" | "queue";
    gc?: boolean;
    retentionInDays?: number;
    concurrency?: number;
    maxRetries?: number;
    speculativeRetryThreshold?: number;
}

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

export class Cloud<O extends CommonOptions, S> {
    name: string = this.impl.name;

    protected constructor(protected impl: CloudImpl<O, S>) {
        info(`Node version: ${process.version}`);
    }

    get defaults() {
        return this.impl.defaults;
    }

    pack(fmodule: string, options?: O): Promise<PackerResult> {
        if (options && options.childProcess !== undefined) {
            options.wrapperOptions = {
                ...options.wrapperOptions,
                useChildProcess: options.childProcess
            };
        }
        return this.impl.pack(resolveModule(fmodule), options);
    }

    async createFunction(modulePath: string, options?: O): Promise<CloudFunction<O, S>> {
        const resolvedModule = resolveModule(modulePath);
        const functionId = uuidv4();
        return new CloudFunction(
            this,
            this.impl.getFunctionImpl(),
            await this.impl.initialize(resolvedModule, functionId, options),
            resolvedModule,
            options
        );
    }
}

export type AnyCloud = Cloud<any, any>;

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

export class CloudFunction<O extends CommonOptions, S> {
    cloudName = this.impl.name;
    functionCounters = new FunctionCountersMap();
    functionStats = new FunctionStatsMap();
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

    constructor(
        protected cloud: Cloud<O, S>,
        protected impl: CloudFunctionImpl<S>,
        readonly state: S,
        readonly modulePath: string,
        readonly options?: O
    ) {
        let concurrency = (options && options.concurrency) || cloud.defaults.concurrency;
        if (!concurrency) {
            warn(
                `Default concurrency level not defined for cloud type '${
                    cloud.name
                }', defaulting to 1`
            );
            concurrency = 1;
        }
        this.funnel = new Funnel<any>(concurrency);
        this.memorySize = (options && options.memorySize) || cloud.defaults.memorySize!;
        this.timeout = (options && options.timeout) || cloud.defaults.timeout;
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
    }

    async cleanup() {
        this.funnel.clear();
        this.cleanupHooks.forEach(hook => hook());
        this.cleanupHooks.clear();
        this.stopPrintStatisticsInterval();
        return this.impl.cleanup(this.state);
    }

    stop() {
        this.funnel.clear();
        this.cleanupHooks.forEach(hook => hook());
        this.cleanupHooks.clear();
        this.stopPrintStatisticsInterval();
        return this.impl.stop(this.state);
    }

    logUrl() {
        return this.impl.logUrl(this.state);
    }

    printStatisticsInterval(intervalMs: number, print: (msg: string) => void = stats) {
        this.statsTimer && clearInterval(this.statsTimer);
        this.statsTimer = setInterval(() => {
            this.functionCounters.fIncremental.forEach((counters, fn) => {
                const execStats = this.functionStats.fIncremental.get(fn);
                const executionLatency = execStats ? execStats.executionLatency.mean : 0;
                print(
                    `[${fn}] ${counters}, executionLatency: ${(
                        executionLatency / 1000
                    ).toFixed(2)}s`
                );
            });
            this.functionCounters.resetIncremental();
            this.functionStats.resetIncremental();
        }, intervalMs);
    }

    stopPrintStatisticsInterval() {
        this.statsTimer && clearInterval(this.statsTimer);
        this.statsTimer = undefined;
    }

    wrapModule<M>(fmodule: M): Promisified<M> {
        const rv: any = {};
        for (const name of Object.keys(fmodule)) {
            if (typeof fmodule[name] === "function") {
                rv[name] = this.wrapFunction(fmodule[name]);
            }
        }
        return rv;
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

export type AnyCloudFunction = CloudFunction<any, any>;

export class AWS extends Cloud<aws.Options, aws.State> {
    constructor() {
        super(aws.Impl);
    }
}

export class AWSLambda extends CloudFunction<aws.Options, aws.State> {}

export class Google extends Cloud<google.Options, google.State> {
    constructor() {
        super(google.Impl);
    }
}

export class GoogleCloudFunction extends CloudFunction<google.Options, google.State> {}

export class GoogleEmulator extends Cloud<google.Options, google.State> {
    constructor() {
        super(google.EmulatorImpl);
    }
}

export class Local extends Cloud<local.Options, local.State> {
    constructor() {
        super(local.Impl);
    }
}

export class LocalFunction extends CloudFunction<local.Options, local.State> {}

export type CloudProvider = "aws" | "google" | "google-emulator" | "local";

export function create(cloudName: "aws"): AWS;
export function create(cloudName: "google"): Google;
export function create(cloudName: "google-emulator"): GoogleEmulator;
export function create(cloudName: "local"): Local;
export function create(cloudName: CloudProvider): Cloud<any, any>;
export function create(cloudName: CloudProvider): Cloud<any, any> {
    if (cloudName === "aws") {
        return new AWS();
    } else if (cloudName === "google") {
        return new Google();
    } else if (cloudName === "google-emulator") {
        return new GoogleEmulator();
    } else if (cloudName === "local") {
        return new Local();
    }
    return assertNever(cloudName);
}

export interface Wrapped<O extends CommonOptions, S, M extends object> {
    remote: Promisified<M>;
    cloudFunc: CloudFunction<O, S>;
}

export function faastify<M extends object>(
    cloudName: "aws",
    fmodule: M,
    modulePath: string,
    options?: aws.Options
): Promise<Wrapped<aws.Options, aws.State, M>>;
export function faastify<M extends object>(
    cloudName: "google" | "google-emulator",
    fmodule: M,
    modulePath: string,
    options?: google.Options
): Promise<Wrapped<google.Options, google.State, M>>;
export function faastify<M extends object>(
    cloudName: "local",
    fmodule: M,
    modulePath: string,
    options?: local.Options
): Promise<Wrapped<local.Options, local.State, M>>;
export function faastify<S, M extends object>(
    cloudName: CloudProvider,
    fmodule: M,
    modulePath: string,
    options?: CommonOptions
): Promise<Wrapped<CommonOptions, S, M>>;
export async function faastify<O extends CommonOptions, S, M extends object>(
    cloudProvider: CloudProvider,
    fmodule: M,
    modulePath: string,
    options?: O
): Promise<Wrapped<O, S, M>> {
    const cloud = create(cloudProvider);
    const cloudFunc = await cloud.createFunction(modulePath, options);
    const remote = cloudFunc.wrapModule(fmodule);
    return { remote, cloudFunc };
}

export interface CloudImpl<O, S> {
    name: string;
    initialize(serverModule: string, functionId: string, options?: O): Promise<S>;
    pack(functionModule: string, options?: O): Promise<PackerResult>;
    getFunctionImpl(): CloudFunctionImpl<S>;
    defaults: O;
}

export interface CloudFunctionImpl<State> {
    name: string;

    costEstimate?: (
        state: State,
        counters: FunctionCounters,
        stats: FunctionStats
    ) => Promise<costAnalyzer.CostBreakdown>;

    callFunction(state: State, call: FunctionCall): Promise<FunctionReturnWithMetrics>;

    cleanup(state: State): Promise<void>;
    stop(state: State): Promise<void>;
    logUrl(state: State): string;
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
