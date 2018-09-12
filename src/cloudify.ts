import * as path from "path";
import * as uuidv4 from "uuid/v4";
import * as aws from "./aws/aws-cloudify";
import * as childprocess from "./childprocess/childprocess-cloudify";
import * as google from "./google/google-cloudify";
import * as immediate from "./immediate/immediate-cloudify";
import { log, stats, warn } from "./log";
import { PackerOptions, PackerResult } from "./packer";
import { assertNever, FactoryMap, Statistics, sum } from "./shared";
import { FunctionCall, FunctionReturnWithMetrics, FunctionReturn } from "./trampoline";
import { NonFunctionProperties, Unpacked } from "./type-helpers";
import Module = require("module");

export { aws, google, childprocess, immediate };

if (!Symbol.asyncIterator) {
    (Symbol as any).asyncIterator =
        Symbol.asyncIterator || Symbol.for("Symbol.asyncIterator");
}

export type Logger = (msg: string) => void;

export interface ResponseDetails<D> {
    value?: D;
    error?: Error;
    rawResponse: any;
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

export interface CommonOptions extends PackerOptions {
    timeout?: number;
    memorySize?: number;
    useQueue?: boolean;
}

function resolve(fmodule: string) {
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

    constructor(protected impl: CloudImpl<O, S>) {}

    cleanupResources(resources: string): Promise<void> {
        return this.impl.cleanupResources(resources);
    }

    pack(fmodule: string, options?: O): Promise<PackerResult> {
        return this.impl.pack(resolve(fmodule), options);
    }

    async createFunction(fmodule: string, options?: O): Promise<CloudFunction<O, S>> {
        return new CloudFunction(
            this.impl.getFunctionImpl(),
            await this.impl.initialize(resolve(fmodule), options),
            options
        );
    }
}

export type AnyCloud = Cloud<any, any>;

export class CostMetric {
    pricing = 0;
    unit = "";
    measured = 0;
    comment?: string;

    constructor(opts?: NonFunctionProperties<CostMetric>) {
        Object.assign(this, opts);
    }

    cost() {
        return this.pricing * this.measured;
    }

    toString() {
        return `$${this.p(this.pricing)}/${this.unit} x ${this.describe(
            this.measured,
            this.unit
        )} = $${this.p(this.cost())}${this.comment || ""}`;
    }

    protected p = (n: number) => (Number.isInteger(n) ? n : n.toFixed(8));
    protected addPlural = (n: number, str: string) =>
        n > 1 && !str.match(/[A-Z]$/) ? "s" : "";
    protected describe = (measured: number, unit: string) =>
        `${this.p(measured)} ${unit + this.addPlural(measured, unit)}`;
}

export class CostBreakdown {
    costs: { [metric: string]: CostMetric } = {};

    constructor(metrics?: { [metric: string]: CostMetric }) {
        Object.assign(this.costs, metrics);
    }

    estimateTotal() {
        return sum(Object.values(this.costs || {}).map(metric => metric.cost()));
    }

    toString() {
        let rv = "";
        const costs = [];

        for (const [name, metric] of Object.entries(this.costs || {})) {
            costs.push({
                metric: name,
                cost: metric.cost(),
                description: metric.toString()
            });
        }

        costs.sort((a, b) => b.cost - a.cost);
        const total = this.estimateTotal();

        for (const entry of costs) {
            rv += `${((entry.cost / total) * 100).toFixed(1).padStart(5)}% ${
                entry.metric
            }: ${entry.description}\n`;
        }

        rv += `estimated total: $${this.estimateTotal().toFixed(8)}\n`;
        rv += `(Estimated using highest pricing tier for each service. Does not account for free tier. Limitations apply.)`;
        return rv;
    }

    [Symbol.iterator]() {
        return Object.entries(this.costs)[Symbol.iterator]();
    }

    get(metric: string) {
        return this.costs[metric];
    }
}

export class FunctionCounters {
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
    localStartLatencyMs = new Statistics();
    remoteStartLatencyMs = new Statistics();
    executionLatencyMs = new Statistics();
    sendResponseLatencyMs = new Statistics();
    returnLatencyMs = new Statistics();
    estimatedBilledTimeMs = new Statistics();
}

export class FunctionCountersMap {
    aggregate = new FunctionCounters();
    fIncremental = new FactoryMap<string, FunctionCounters>(() => new FunctionCounters());
    fAggregate = new FactoryMap<string, FunctionCounters>(() => new FunctionCounters());

    incr(fn: string, key: keyof NonFunctionProperties<FunctionCounters>) {
        this.fIncremental.getOrCreate(fn)[key]++;
        this.fAggregate.getOrCreate(fn)[key]++;
        this.aggregate[key]++;
    }

    resetIncremental() {
        this.fIncremental.clear();
    }

    logIncremental(prefix: string = "") {
        this.print(prefix, this.fIncremental);
    }

    log(prefix: string = "") {
        this.print(prefix, this.fAggregate);
    }

    protected print(prefix: string = "", counters: FactoryMap<string, FunctionCounters>) {
        prefix = prefix === "" ? "" : prefix.trim() + " ";
        stats(
            `${prefix}${[...counters]
                .map(([key, value]) => `${key}: ${value}`)
                .join(", ")}`
        );
    }
}

export class FunctionStatsMap {
    fIncremental = new FactoryMap<string, FunctionStats>(() => new FunctionStats());
    fAggregate = new FactoryMap<string, FunctionStats>(() => new FunctionStats());
    aggregate = new FunctionStats();

    update(fn: string, key: keyof FunctionStats, value: number | undefined) {
        this.fIncremental.getOrCreate(fn)[key].update(value);
        this.fAggregate.getOrCreate(fn)[key].update(value);
        this.aggregate[key].update(value);
    }

    resetIncremental() {
        this.fIncremental.clear();
    }

    logIncremental(prefix: string = "", detailedOpt?: { detailed: boolean }) {
        this.print(prefix, this.fIncremental, detailedOpt);
    }

    log(prefix: string = "", detailedOpt?: { detailed: boolean }) {
        this.print(prefix, this.fAggregate, detailedOpt);
    }

    protected print(
        prefix: string = "",
        map: FactoryMap<string, FunctionStats>,
        detailedOpt?: { detailed: boolean }
    ) {
        prefix = prefix === "" ? "" : prefix.trim() + " ";
        if (detailedOpt && detailedOpt.detailed) {
            for (const [func, fstatistics] of map) {
                for (const stat of Object.keys(fstatistics)) {
                    const fstats = fstatistics[stat] as Statistics;
                    fstats.log(`${prefix}${func} ${stat}`, detailedOpt);
                }
            }
        } else {
            for (const [func, fstatistics] of map) {
                stats(
                    `${prefix}${func}: {${Object.keys(fstatistics)
                        .map(key => `${key}: ${fstatistics[key].mean.toFixed(1)}`)
                        .join(", ")}}`
                );
            }
        }
    }
}

function processResponse<R>(
    returnedMetrics: FunctionReturnWithMetrics,
    callRequest: FunctionCall,
    localStartTime: number,
    fcounters: FunctionCountersMap,
    fstats: FunctionStatsMap
) {
    const returned = returnedMetrics.returned;
    let error: Error | undefined;
    if (returned.type === "error") {
        const errValue = returned.value;
        if (Object.keys(errValue).length === 0 && !(errValue instanceof Error)) {
            warn(
                `Error response object has no keys, likely a bug in cloudify (not serializing error objects)`
            );
        }
        error = new Error(errValue.message);
        error.name = errValue.name;
        error.stack = errValue.stack;
    }
    const value = !error && returned.value;
    let rv: Response<R> = {
        value,
        error,
        rawResponse: returnedMetrics.rawResponse
    };
    const fn = callRequest.name;
    fcounters.incr(fn, "completed");
    const {
        localRequestSentTime,
        remoteResponseSentTime,
        localEndTime,
        returned: { remoteExecutionStartTime, remoteExecutionEndTime }
    } = returnedMetrics;
    if (remoteExecutionStartTime && remoteExecutionEndTime) {
        const localStartLatency = localRequestSentTime - localStartTime;
        const roundTripLatency = localEndTime - localRequestSentTime;
        const executionLatency = remoteExecutionEndTime - remoteExecutionStartTime;
        const sendResponseLatency = remoteResponseSentTime - remoteExecutionEndTime;
        const networkLatency = roundTripLatency - executionLatency - sendResponseLatency;
        const estimatedRemoteStartTime = localRequestSentTime + networkLatency / 2;
        const skew = estimatedRemoteStartTime - remoteExecutionStartTime;

        const remoteStartLatency = remoteExecutionStartTime + skew - localRequestSentTime;
        const returnLatency = localEndTime - (remoteExecutionEndTime + skew);
        fstats.update(fn, "localStartLatencyMs", localStartLatency);
        fstats.update(fn, "remoteStartLatencyMs", remoteStartLatency);
        fstats.update(fn, "executionLatencyMs", executionLatency);
        fstats.update(fn, "sendResponseLatencyMs", sendResponseLatency);
        fstats.update(fn, "returnLatencyMs", returnLatency);

        const billed = (executionLatency || 0) + (sendResponseLatency || 0);
        const estimatedBilledTime = Math.ceil(billed / 100) * 100;
        fstats.update(fn, "estimatedBilledTimeMs", estimatedBilledTime);
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
    }
    return rv;
}

export class CloudFunction<O extends CommonOptions, S> {
    cloudName = this.impl.name;
    functionCounters = new FunctionCountersMap();
    functionStats = new FunctionStatsMap();
    protected logger?: Logger;
    protected timer?: NodeJS.Timer;

    constructor(
        protected impl: CloudFunctionImpl<S>,
        readonly state: S,
        readonly options?: O
    ) {}

    cleanup() {
        this.stopPrintStatisticsInterval();
        return this.impl.cleanup(this.state);
    }

    stop() {
        return this.impl.stop(this.state);
    }

    printIncremental() {
        this.functionCounters.logIncremental();
        this.functionStats.logIncremental();
    }

    printStatisticsInterval(interval: number) {
        this.timer && clearInterval(this.timer);
        this.timer = setInterval(() => {
            this.printIncremental();
            this.functionCounters.resetIncremental();
            this.functionStats.resetIncremental();
        }, interval);
    }

    stopPrintStatisticsInterval() {
        this.timer && clearInterval(this.timer);
        this.timer = undefined;
    }

    setConcurrency(maxConcurrentExecutions: number): Promise<void> {
        return this.impl.setConcurrency(this.state, maxConcurrentExecutions);
    }

    cloudifyWithResponse<A extends any[], R>(
        fn: (...args: A) => R
    ): ResponsifiedFunction<A, R> {
        const responsifedFunc = async (...args: A) => {
            const CallId = uuidv4();
            const startTime = Date.now();
            const callRequest: FunctionCall = { name: fn.name, args, CallId };
            const rv: FunctionReturnWithMetrics = await this.impl
                .callFunction(this.state, callRequest)
                .catch(value => {
                    const returned: FunctionReturn = {
                        type: "error",
                        value,
                        CallId,
                        remoteExecutionStartTime: startTime,
                        remoteExecutionEndTime: Date.now()
                    };
                    return {
                        returned,
                        rawResponse: {},
                        localRequestSentTime: startTime,
                        remoteResponseSentTime: returned.remoteExecutionEndTime!,
                        localEndTime: Date.now()
                    };
                });
            return processResponse<R>(
                rv,
                callRequest,
                startTime,
                this.functionCounters,
                this.functionStats
            );
        };
        return responsifedFunc;
    }

    cloudify<A extends any[], R>(fn: (...args: A) => R): PromisifiedFunction<A, R> {
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

    cloudifyAll<M>(fmodule: M): Promisified<M> {
        const rv: any = {};
        for (const name of Object.keys(fmodule)) {
            if (typeof fmodule[name] === "function") {
                rv[name] = this.cloudify(fmodule[name]);
            }
        }
        return rv;
    }

    cloudifyAllWithResponse<M>(fmodule: M): Responsified<M> {
        const rv: any = {};
        for (const name of Object.keys(fmodule)) {
            if (typeof fmodule[name] === "function") {
                rv[name] = this.cloudifyWithResponse(fmodule[name]);
            }
        }
        return rv;
    }

    setLogger(logger: Logger | undefined) {
        this.logger = logger;
        this.impl.setLogger(this.state, logger);
    }

    costEstimate(): Promise<CostBreakdown> {
        if (this.impl.costEstimate) {
            return this.impl.costEstimate(
                this.state,
                this.functionCounters.aggregate,
                this.functionStats.aggregate
            );
        } else {
            return Promise.resolve(new CostBreakdown());
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

export interface CloudImpl<O, S> {
    name: string;
    initialize(serverModule: string, options?: O): Promise<S>;
    cleanupResources(resources: string): Promise<void>;
    pack(functionModule: string, options?: O): Promise<PackerResult>;
    getFunctionImpl(): CloudFunctionImpl<S>;
}

export interface CloudFunctionImpl<State> {
    name: string;
    costEstimate?: (
        state: State,
        counters: FunctionCounters,
        stats: FunctionStats
    ) => Promise<CostBreakdown>;
    callFunction(state: State, call: FunctionCall): Promise<FunctionReturnWithMetrics>;
    cleanup(state: State): Promise<void>;
    stop(state: State): Promise<string>;
    setConcurrency(state: State, maxConcurrentExecutions: number): Promise<void>;
    setLogger(state: State, logger: Logger | undefined): void;
}

export interface LogEntry {
    timestamp: number;
    message: string;
}
