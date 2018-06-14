require("source-map-support").install();

import * as aws from "./aws/aws-cloudify";
import * as google from "./google/google-cloudify";
import { PackerResult } from "./packer";

export type AnyFunction = (...args: any[]) => any;

export type Unpacked<T> = T extends Promise<infer D> ? D : T;

export type PromisifiedFunction<T extends AnyFunction> =
    // prettier-ignore
    T extends () => infer D ? () => Promise<Unpacked<D>> :
    T extends (a1: infer A1) => infer D ? (a1: A1) => Promise<Unpacked<D>> :
    T extends (a1: infer A1, a2: infer A2) => infer D ? (a1: A1, a2: A2) => Promise<Unpacked<D>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3) => infer D ? (a1: A1, a2: A2, a3: A3) => Promise<Unpacked<D>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4) => infer D ? (a1: A1, a2: A2, a3: A3, a4: A4) => Promise<Unpacked<D>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5) => infer D ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5) => Promise<Unpacked<D>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5, a6: infer A6) => infer D ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6) => Promise<Unpacked<D>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5, a6: infer A6, a7: infer A7) => infer D ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7) => Promise<Unpacked<D>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5, a6: infer A6, a7: infer A7, a8: infer A8) => infer D ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7, a8: A8) => Promise<Unpacked<D>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5, a6: infer A6, a7: infer A7, a8: infer A8, a9: infer A9) => infer D ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7, a8: A8, a9: A9) => Promise<Unpacked<D>> :
    T extends (...args: any[]) => infer D ? (...args: any[]) => Promise<Unpacked<D>> : T;

export type Promisified<M> = {
    [K in keyof M]: M[K] extends AnyFunction ? PromisifiedFunction<M[K]> : never
};

export interface ResponseDetails<D> {
    value?: D;
    error?: Error;
    rawResponse: any;
}

export type Response<D> = ResponseDetails<Unpacked<D>>;

export type ResponsifiedFunction<T extends AnyFunction> =
    // prettier-ignore
    T extends () => infer D ? () => Promise<Response<D>> :
    T extends (a1: infer A1) => infer D ? (a1: A1) => Promise<Response<D>> :
    T extends (a1: infer A1, a2: infer A2) => infer D ? (a1: A1, a2: A2) => Promise<Response<D>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3) => infer D ? (a1: A1, a2: A2, a3: A3) => Promise<Response<D>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4) => infer D ? (a1: A1, a2: A2, a3: A3, a4: A4) => Promise<Response<D>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5) => infer D ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5) => Promise<Response<D>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5, a6: infer A6) => infer D ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6) => Promise<Response<D>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5, a6: infer A6, a7: infer A7) => infer D ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7) => Promise<Response<D>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5, a6: infer A6, a7: infer A7, a8: infer A8) => infer D ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7, a8: A8) => Promise<Response<D>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5, a6: infer A6, a7: infer A7, a8: infer A8, a9: infer A9) => infer D ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7, a8: A8, a9: A9) => Promise<Response<D>> :
    T extends (...args: any[]) => infer D ? (...args: any[]) => Promise<Response<D>> :T;

export type Responsified<M> = {
    [K in keyof M]: M[K] extends AnyFunction ? ResponsifiedFunction<M[K]> : never
};

export interface Options<CloudSpecificOptions> {
    timeout?: number;
    memorySize?: number;
    cloudSpecific?: CloudSpecificOptions;
}

export interface Cloud<O, S> {
    name: string;
    cleanupResources(resources: string): Promise<void>;
    pack(fmodule: string): Promise<PackerResult>;
    createFunction(fmodule: string, options?: Options<O>): Promise<CloudFunction<S>>;
}

export abstract class CloudFunction<S> {
    abstract cloudName: string;
    abstract cloudifyWithResponse<F extends AnyFunction>(fn: F): ResponsifiedFunction<F>;
    abstract cleanup(): Promise<void>;
    abstract getResourceList(): string;
    abstract getState(): S;
    abstract cancelAll(): Promise<void>;
    abstract setConcurrency(maxConcurrentExecutions: number): Promise<void>;

    cloudify<F extends AnyFunction>(fn: F): PromisifiedFunction<F> {
        const cloudifiedFunc = async (...args: any[]) => {
            const cfn = this.cloudifyWithResponse<F>(fn) as any;
            const response: Response<ReturnType<F>> = await cfn(...args);
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
}

export class AWS implements Cloud<aws.Options, aws.State> {
    name = aws.name;
    cleanupResources = aws.cleanupResources;
    pack(fmodule: string) {
        return aws.pack(resolve(fmodule));
    }
    async createFunction(
        fmodule: string,
        { timeout, memorySize, cloudSpecific }: Options<aws.Options> = {}
    ): Promise<AWSLambda> {
        const options: aws.Options = { timeout, memorySize, ...cloudSpecific };
        return new AWSLambda(await aws.initialize(resolve(fmodule), options));
    }
}

export class AWSLambda extends CloudFunction<aws.State> {
    cloudName = aws.name;
    constructor(readonly state: aws.State) {
        super();
    }
    cloudifyWithResponse<F extends AnyFunction>(fn: F) {
        return aws.cloudifyWithResponse(this.state, fn);
    }
    cleanup() {
        return aws.cleanup(this.state);
    }
    cancelAll() {
        return aws.cancelWithoutCleanup(this.state);
    }
    getResourceList() {
        return aws.getResourceList(this.state);
    }
    getState() {
        return this.state;
    }
    setConcurrency(maxConcurrentExecutions: number): Promise<void> {
        return aws.setConcurrency(this.state, maxConcurrentExecutions);
    }
}

export class Google implements Cloud<google.Options, google.State> {
    name = google.name;
    cleanupResources = google.cleanupResources;
    pack(fmodule: string) {
        return google.pack(resolve(fmodule));
    }
    async createFunction(
        fmodule: string,
        { timeout, memorySize, cloudSpecific }: Options<google.Options> = {}
    ) {
        const options: google.Options = {
            timeoutSec: timeout,
            memorySize,
            ...cloudSpecific
        };
        return new GoogleCloudFunction(
            await google.initialize(resolve(fmodule), options)
        );
    }
}

export class GoogleCloudFunction extends CloudFunction<google.State> {
    cloudName = google.name;
    constructor(readonly state: google.State) {
        super();
    }
    cloudifyWithResponse<F extends AnyFunction>(fn: F) {
        return google.cloudifyWithResponse(this.state, fn);
    }
    cleanup() {
        return google.cleanup(this.state);
    }
    cancelAll(): Promise<void> {
        throw new Error("Not implemented");
    }
    getResourceList() {
        return google.getResourceList(this.state);
    }
    getState() {
        return this.state;
    }
    setConcurrency(_maxConcurrentExecutions: number): Promise<void> {
        throw new Error("Method not implemented.");
    }
}

export class GoogleEmulator extends Google {
    async createFunction(
        fmodule: string,
        { timeout, memorySize, cloudSpecific }: Options<google.Options> = {}
    ) {
        const options: google.Options = {
            timeoutSec: timeout,
            memorySize,
            ...cloudSpecific
        };
        return new GoogleCloudFunction(
            await google.initializeEmulator(resolve(fmodule), options)
        );
    }
}

const resolve = (module.parent!.require as NodeRequire).resolve;

export function create(cloudName: "aws"): AWS;
export function create(cloudName: "google"): Google;
export function create(cloudName: "google-emulator"): GoogleEmulator;
export function create(cloudName: string): Cloud<any, any> {
    if (cloudName === "aws") {
        return new AWS();
    } else if (cloudName === "google") {
        return new Google();
    } else if (cloudName === "google-emulator") {
        return new GoogleEmulator();
    }
    throw new Error(`Unknown cloud name: "${cloudName}"`);
}

export interface CloudImpl<Options, State> {
    name: string;
    initialize(serverModule: string, options?: Options): Promise<State>;
    cloudifyWithResponse<F extends AnyFunction>(
        state: State,
        fn: F
    ): ResponsifiedFunction<F>;
    cleanup(state: State): Promise<void>;
    cancelWithoutCleanup(state: State): Promise<void>;
    getResourceList(state: State): string;
    cleanupResources(resources: string): Promise<void>;
    pack(functionModule: string): Promise<PackerResult>;
}
