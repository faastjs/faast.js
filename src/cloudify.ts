import * as path from "path";
import * as uuidv4 from "uuid/v4";
import * as aws from "./aws/aws-cloudify";
import * as childprocess from "./childprocess/childprocess-cloudify";
import * as costAnalyzer from "./cost-analyzer";
import * as google from "./google/google-cloudify";
import * as immediate from "./immediate/immediate-cloudify";
import { log, stats, warn, logLeaks } from "./log";
import { PackerOptions, PackerResult } from "./packer";
import {
    assertNever,
    FactoryMap,
    Statistics,
    sleep,
    roundTo100ms,
    ExponentiallyDecayingAverageValue
} from "./shared";
import { FunctionCall, FunctionReturn, FunctionReturnWithMetrics } from "./trampoline";
import { NonFunctionProperties, Unpacked } from "./type-helpers";
import Module = require("module");
import { Funnel, retry, Future, Deferred } from "./funnel";

export { aws, google, childprocess, immediate, costAnalyzer };

if (!Symbol.asyncIterator) {
    (Symbol as any).asyncIterator =
        Symbol.asyncIterator || Symbol.for("Symbol.asyncIterator");
}

export class CloudifyError extends Error {
    logUrl?: string;
}

export interface ResponseDetails<D> {
    value?: D;
    error?: Error;
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
    timeout?: number;
    memorySize?: number;
    mode?: "https" | "queue";
    gc?: boolean;
    retentionInDays?: number;
    concurrency?: number;
}

function resolveModule(fmodule: string) {
    const parent = module.parent!;
    if (parent.filename.match(/aws-cloudify/)) {
        log(
            `WARNING: import cloudify before aws-cloudify to avoid problems with module resolution`
        );
    }
    if (path.isAbsolute(fmodule)) {
        return fmodule;
    }
    return (Module as any)._resolveFilename(fmodule, module.parent);
}

export class Cloud<O extends CommonOptions, S> {
    name: string = this.impl.name;

    protected constructor(protected impl: CloudImpl<O, S>) {}

    get defaults() {
        return this.impl.defaults;
    }

    cleanupResources(resources: string): Promise<void> {
        return this.impl.cleanupResources(resources);
    }

    pack(fmodule: string, options?: O): Promise<PackerResult> {
        return this.impl.pack(resolveModule(fmodule), options);
    }

    async createFunction(modulePath: string, options?: O): Promise<CloudFunction<O, S>> {
        return new CloudFunction(
            this,
            this.impl.getFunctionImpl(),
            await this.impl.initialize(resolveModule(modulePath), options),
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
    localStartLatency = new Statistics(0.1);
    remoteStartLatency = new Statistics(0.1);
    executionLatency = new Statistics(0.1);
    sendResponseLatency = new Statistics(0.1);
    returnLatency = new Statistics(0.1);
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
    memoryLeakDetector: MemoryLeakDetector,
    tailLatencyRetries: number
) {
    const returned = returnedMetrics.returned;
    let error: CloudifyError | undefined;
    const { executionId, logUrl, instanceId, memoryUsage } = returned;
    if (returned.type === "error") {
        const errValue = returned.value;
        if (Object.keys(errValue).length === 0 && !(errValue instanceof Error)) {
            warn(
                `Error response object has no keys, likely a bug in cloudify (not serializing error objects)`
            );
        }
        error = new CloudifyError(errValue.message + `\n(logs: ${logUrl})`);
        error.logUrl = logUrl;
        error.name = errValue.name;
        error.stack = errValue.stack;
    }
    const value = !error && returned.value;
    const {
        localRequestSentTime,
        remoteResponseSentTime,
        localEndTime,
        rawResponse
    } = returnedMetrics;
    let rv: Response<R> = {
        value,
        error,
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
        fstats.update(
            fn,
            "estimatedBilledTime",
            estimatedBilledTime * (1 + tailLatencyRetries)
        );
        rv = {
            ...rv,
            localStartLatency,
            remoteStartLatency,
            executionLatency,
            sendResponseLatency,
            returnLatency
        };
    }

    if (error) {
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
                `These logs show only one example cloudify function invocation that may have a leak.`
            );
        }
    }

    return rv;
}

export class CloudFunction<O extends CommonOptions, S> {
    cloudName = this.impl.name;
    functionCounters = new FunctionCountersMap();
    functionStats = new FunctionStatsMap();
    memoryLeakDetector: MemoryLeakDetector;
    funnel = new Funnel<any>();

    protected memorySize: number | undefined;
    protected timeout: number | undefined;
    protected skew = new ExponentiallyDecayingAverageValue(0.3);
    protected statsTimer?: NodeJS.Timer;
    protected timers: Set<NodeJS.Timer> = new Set();
    protected initialInvocationTime: Map<string, number> = new Map();

    constructor(
        protected cloud: Cloud<O, S>,
        protected impl: CloudFunctionImpl<S>,
        readonly state: S,
        readonly options?: O
    ) {
        this.impl.logUrl && log(`Log URL: ${this.impl.logUrl(state)}`);
        const concurrency =
            (options && options.concurrency) || cloud.defaults.concurrency || 1;
        this.funnel.setMaxConcurrency(concurrency);
        this.memorySize = (options && options.memorySize) || cloud.defaults.memorySize!;
        this.timeout = (options && options.timeout) || cloud.defaults.timeout;
        this.memoryLeakDetector = new MemoryLeakDetector(this.memorySize);
    }

    cleanup() {
        this.funnel.clear();
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
        this.stopPrintStatisticsInterval();
        return this.impl.cleanup(this.state);
    }

    stop() {
        this.funnel.clear();
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
        this.stopPrintStatisticsInterval();
        return this.impl.stop(this.state);
    }

    logUrl() {
        return this.impl.logUrl && this.impl.logUrl(this.state);
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

    setConcurrency(maxConcurrentExecutions: number) {
        this.funnel.setMaxConcurrency(maxConcurrentExecutions);
    }

    cloudifyModule<M>(fmodule: M): Promisified<M> {
        const rv: any = {};
        for (const name of Object.keys(fmodule)) {
            if (typeof fmodule[name] === "function") {
                rv[name] = this.cloudifyFunction(fmodule[name]);
            }
        }
        return rv;
    }

    cloudifyWithResponse<A extends any[], R>(
        fn: (...args: A) => R
    ): ResponsifiedFunction<A, R> {
        const shouldRetry = (_: any, n: number) => {
            if (this.cloudName === "aws" && this.options!.mode === "queue") {
                // SNS has automatic retry.
                return false;
            }
            this.functionCounters.incr(fn.name, "retries");
            return n < 3;
        };
        return async (...args: A) => {
            let initialInvocationTime = this.initialInvocationTime.get(fn.name);
            if (!initialInvocationTime) {
                const start = Date.now();
                this.initialInvocationTime.set(fn.name, start);
                initialInvocationTime = start;
            }
            this.functionCounters.incr(fn.name, "invocations");
            // XXX capture google retries in stats?
            return this.funnel.pushRetry(shouldRetry, async () => {
                const deferred = new Deferred<FunctionReturnWithMetrics>();
                let startTime: number = Date.now();
                const CallId = uuidv4();
                const callRequest: FunctionCall = { name: fn.name, args, CallId };
                let pending = true;

                deferred.promise.then(_ => (pending = false));

                const invokeCloudFunction = () => {
                    startTime = Date.now();
                    this.impl
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

                let timer!: NodeJS.Timer;
                let tailLatencyRetries = 0;
                const retryFunctionIfNeededToReduceTailLatency = async () => {
                    const fnStats = this.functionStats.fAggregate.getOrCreate(fn.name);
                    while (pending && tailLatencyRetries < 3) {
                        const {
                            executionLatency,
                            localStartLatency,
                            remoteStartLatency,
                            returnLatency
                        } = fnStats;
                        const lastInvocationLatency = Date.now() - startTime;
                        const elapsedSinceInitialInvocation =
                            Date.now() - initialInvocationTime!;

                        const latencyLimitBeforeRetry =
                            localStartLatency.mean +
                            remoteStartLatency.mean +
                            executionLatency.mean +
                            3 * executionLatency.stdev +
                            returnLatency.mean;
                        if (
                            latencyLimitBeforeRetry &&
                            lastInvocationLatency > latencyLimitBeforeRetry &&
                            elapsedSinceInitialInvocation > latencyLimitBeforeRetry
                        ) {
                            tailLatencyRetries++;
                            this.functionCounters.incr(fn.name, "retries");
                            invokeCloudFunction();
                        } else {
                            const timeout = latencyLimitBeforeRetry || 0;
                            const waitedAlready = Date.now() - startTime;
                            const waitTime = roundTo100ms(
                                Math.max(timeout - waitedAlready, 5000)
                            );

                            await new Promise(resolve => {
                                timer = setTimeout(resolve, waitTime);
                                this.timers.add(timer);
                            });
                            this.timers.delete(timer);
                        }
                    }
                };

                invokeCloudFunction();
                retryFunctionIfNeededToReduceTailLatency();

                const rv = await deferred.promise;
                clearTimeout(timer);
                return processResponse<R>(
                    rv,
                    callRequest,
                    startTime,
                    this.functionCounters,
                    this.functionStats,
                    this.skew,
                    this.memoryLeakDetector,
                    tailLatencyRetries
                );
            });
        };
    }

    cloudifyFunction<A extends any[], R>(
        fn: (...args: A) => R
    ): PromisifiedFunction<A, R> {
        const cloudifiedFunc = async (...args: A) => {
            const cfn = this.cloudifyWithResponse(fn);
            const response: Response<R> = await cfn(...args);
            if (response.error) {
                throw response.error;
            }
            return response.value;
        };
        return cloudifiedFunc as any;
    }

    costEstimate(): Promise<costAnalyzer.CostBreakdown> {
        if (this.impl.costEstimate) {
            return this.impl.costEstimate(
                this.state,
                this.functionCounters.aggregate,
                this.functionStats.aggregate
            );
        } else {
            return Promise.resolve(new costAnalyzer.CostBreakdown());
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

export class ChildProcess extends Cloud<childprocess.Options, childprocess.State> {
    constructor() {
        super(childprocess.Impl);
    }
}

export class ChildProcessFunction extends CloudFunction<
    childprocess.Options,
    childprocess.State
> {}

export class Immediate extends Cloud<immediate.Options, immediate.State> {
    constructor() {
        super(immediate.Impl);
    }
}

export class ImmediateFunction extends CloudFunction<
    immediate.Options,
    immediate.State
> {}

export type CloudProvider =
    | "aws"
    | "google"
    | "google-emulator"
    | "childprocess"
    | "immediate";

export function create(cloudName: "aws"): AWS;
export function create(cloudName: "google"): Google;
export function create(cloudName: "google-emulator"): GoogleEmulator;
export function create(cloudName: "childprocess"): ChildProcess;
export function create(cloudName: "immediate"): Immediate;
export function create(cloudName: CloudProvider): Cloud<any, any>;
export function create(cloudName: CloudProvider): Cloud<any, any> {
    if (cloudName === "aws") {
        return new AWS();
    } else if (cloudName === "google") {
        return new Google();
    } else if (cloudName === "google-emulator") {
        return new GoogleEmulator();
    } else if (cloudName === "childprocess") {
        return new ChildProcess();
    } else if (cloudName === "immediate") {
        return new Immediate();
    }
    return assertNever(cloudName);
}

export interface Cloudified<O extends CommonOptions, S, M extends object> {
    remote: Promisified<M>;
    cloudFunc: CloudFunction<O, S>;
}

export function cloudify<M extends object>(
    cloudName: "aws",
    fmodule: M,
    modulePath: string,
    options?: aws.Options
): Promise<Cloudified<aws.Options, aws.State, M>>;
export function cloudify<M extends object>(
    cloudName: "google" | "google-emulator",
    fmodule: M,
    modulePath: string,
    options?: google.Options
): Promise<Cloudified<google.Options, google.State, M>>;
export function cloudify<M extends object>(
    cloudName: "childprocess",
    fmodule: M,
    modulePath: string,
    options?: google.Options
): Promise<Cloudified<childprocess.Options, childprocess.State, M>>;
export function cloudify<M extends object>(
    cloudName: "immediate",
    fmodule: M,
    modulePath: string,
    options?: google.Options
): Promise<Cloudified<immediate.Options, immediate.State, M>>;
export function cloudify<O extends CommonOptions, S, M extends object>(
    cloudName: CloudProvider,
    fmodule: M,
    modulePath: string,
    options?: google.Options
): Promise<Cloudified<O, S, M>>;
export async function cloudify<O extends CommonOptions, S, M extends object>(
    cloudProvider: CloudProvider,
    fmodule: M,
    modulePath: string,
    options?: O
): Promise<Cloudified<O, S, M>> {
    const cloud = create(cloudProvider);
    const cloudFunc = await cloud.createFunction(modulePath, options);
    const remote = cloudFunc.cloudifyModule(fmodule);
    return { remote, cloudFunc };
}

export interface CloudImpl<O, S> {
    name: string;
    initialize(serverModule: string, options?: O): Promise<S>;
    cleanupResources(resources: string): Promise<void>;
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
    stop(state: State): Promise<string>;
    logUrl?: (state: State) => string;
}

export interface LogEntry {
    timestamp: number;
    message: string;
}
