require("source-map-support").install();
import * as uuidv4 from "uuid/v4";
import * as aws from "./aws/aws-cloudify";
import * as google from "./google/google-cloudify";
import { log } from "./log";
import { PackerOptions, PackerResult } from "./packer";
import { FunctionCall, FunctionMetricsMap, FunctionReturn, sleep } from "./shared";
import { Unpacked } from "./type-helpers";
import * as process from "./process/process-cloudify";

if (!Symbol.asyncIterator) {
    (Symbol as any).asyncIterator =
        Symbol.asyncIterator || Symbol.for("Symbol.asyncIterator");
}

export interface ResponseDetails<D> {
    value?: D;
    error?: Error;
    rawResponse: any;
    startLatency?: number;
    executionLatency?: number;
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
    log(`Cloudify module parent: %O`, (parent as any).filename);
    const moduleParentResolve = (parent.require as NodeRequire).resolve;
    return moduleParentResolve(fmodule);
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

    async createFunction(fmodule: string, options?: O): Promise<CloudFunction<S>> {
        return new CloudFunction(
            this.impl.getFunctionImpl(),
            await this.impl.initialize(resolve(fmodule), options)
        );
    }
}

export function processResponse<R>(
    returned: FunctionReturn,
    callRequest: FunctionCall,
    metrics: FunctionMetricsMap
) {
    let error: Error | undefined;
    if (returned.type === "error") {
        const errValue = returned.value;
        error = new Error(errValue.message);
        error.name = errValue.name;
        error.stack = errValue.stack;
    }
    const value = !error && returned.value;
    let rv: Response<R> = {
        value,
        error,
        rawResponse: returned.rawResponse
    };
    const fn = callRequest.name;
    metrics.increment(fn, "completed");
    if (returned.executionStart && returned.executionEnd) {
        const latencies = {
            executionLatency: returned.executionEnd - returned.executionStart,
            startLatency: returned.executionStart - callRequest.start,
            returnLatency: Date.now() - returned.executionEnd
        };
        rv = { ...rv, ...latencies };
        metrics.updateMany(fn, latencies);
    }
    if (error) {
        metrics.increment(fn, "errors");
    }
    return rv;
}

export class CloudFunction<S> {
    cloudName = this.impl.name;
    functionMetrics = new FunctionMetricsMap();
    logging = false;

    constructor(protected impl: CloudFunctionImpl<S>, readonly state: S) {}

    cleanup() {
        this.stopPrintStatisticsInterval();
        return this.impl.cleanup(this.state);
    }

    stop() {
        return this.impl.stop(this.state);
    }

    getResourceList() {
        return this.impl.getResourceList(this.state);
    }

    getState() {
        return this.state;
    }

    printStatisticsInterval(interval: number) {
        this.functionMetrics.logInterval(interval);
    }

    stopPrintStatisticsInterval() {
        this.functionMetrics.stopLogInterval();
    }

    setConcurrency(maxConcurrentExecutions: number): Promise<void> {
        return this.impl.setConcurrency(this.state, maxConcurrentExecutions);
    }

    cloudifyWithResponse<A extends any[], R>(
        fn: (...args: A) => R
    ): ResponsifiedFunction<A, R> {
        const responsifedFunc = async (...args: A) => {
            const CallId = uuidv4();
            const start = Date.now();
            const callRequest: FunctionCall = { name: fn.name, args, CallId, start };
            const rv = await this.impl
                .callFunction(this.state, callRequest)
                .catch(value => {
                    const err: FunctionReturn = {
                        type: "error",
                        value,
                        CallId,
                        executionStart: start,
                        executionEnd: Date.now()
                    };
                    return err;
                });
            return processResponse<R>(rv, callRequest, this.functionMetrics);
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

    cloudifyAll<M>(module: M): Promisified<M> {
        const rv: any = {};
        for (const name of Object.keys(module)) {
            if (typeof module[name] === "function") {
                rv[name] = this.cloudify(module[name]);
            }
        }
        return rv;
    }

    cloudifyAllWithResponse<M>(module: M): Responsified<M> {
        const rv: any = {};
        for (const name of Object.keys(module)) {
            if (typeof module[name] === "function") {
                rv[name] = this.cloudifyWithResponse(module[name]);
            }
        }
        return rv;
    }

    async *streamLogs(pollIntervalMs: number = 1000) {
        while (true) {
            if (!this.logging) {
                return;
            }
            const start = Date.now();
            for await (const logs of this.impl.readLogs(this.state)) {
                yield logs;
                if (!this.logging) {
                    return;
                }
            }
            const elapsed = Date.now() - start;
            if (elapsed < pollIntervalMs) {
                if (!this.logging) {
                    return;
                }
                await sleep(pollIntervalMs - elapsed);
            }
        }
    }

    async printLogs(logger: (message: string) => void = console.log) {
        for await (const entries of this.streamLogs()) {
            entries.forEach(entry =>
                logger(`${new Date(entry.timestamp).toLocaleString()}: ${entry.message}`)
            );
        }
    }

    stopLogs() {
        this.logging = false;
    }
}

export class AWS extends Cloud<aws.Options, aws.State> {
    constructor() {
        super(aws.Impl);
    }
}

export class AWSLambda extends CloudFunction<aws.State> {}

export class Google extends Cloud<google.Options, google.State> {
    constructor() {
        super(google.Impl);
    }
}

export class GoogleEmulator extends Cloud<google.Options, google.State> {
    constructor() {
        super(google.EmulatorImpl);
    }
}

export class Process extends Cloud<process.Options, process.State> {
    constructor() {
        super(process.Impl);
    }
}

export class ProcessFunction extends CloudFunction<process.State> {}

export class GoogleCloudFunction extends CloudFunction<google.State> {}

export type CloudProvider = "aws" | "google" | "google-emulator" | "process";

export function create(cloudName: "aws"): AWS;
export function create(cloudName: "google"): Google;
export function create(cloudName: "google-emulator"): GoogleEmulator;
export function create(cloudName: "process"): Process;
export function create(cloudName: CloudProvider): Cloud<any, any>;
export function create(cloudName: CloudProvider): Cloud<any, any> {
    if (cloudName === "aws") {
        return new AWS();
    } else if (cloudName === "google") {
        return new Google();
    } else if (cloudName === "google-emulator") {
        return new GoogleEmulator();
    } else if (cloudName === "process") {
        return new Process();
    }
    throw new Error(`Unknown cloud name: "${cloudName}"`);
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
    callFunction(state: State, call: FunctionCall): Promise<FunctionReturn>;
    cleanup(state: State): Promise<void>;
    stop(state: State): Promise<void>;
    getResourceList(state: State): string;
    setConcurrency(state: State, maxConcurrentExecutions: number): Promise<void>;
    readLogs(state: State): AsyncIterableIterator<LogEntry[]>;
}

export interface LogEntry {
    timestamp: number;
    message: string;
}
