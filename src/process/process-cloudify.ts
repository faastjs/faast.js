import * as childProcess from "child_process";
import { CloudFunctionImpl, CloudImpl, CommonOptions, LogEntry } from "../cloudify";
import { Funnel } from "../funnel";
import { LogStitcher } from "../logging";
import { PackerResult } from "../packer";
import { FunctionCall, FunctionReturn } from "../shared";

export interface ProcessResources {
    childProcesses: Set<childProcess.ChildProcess>;
}

export interface State {
    resources: ProcessResources;
    callFunnel: Funnel<FunctionReturn>;
    logStitcher: LogStitcher;
    serverModule: string;
}

export interface Options extends CommonOptions {}

export const Impl: CloudImpl<Options, State> = {
    name: "process",
    initialize,
    cleanupResources,
    pack,
    getFunctionImpl
};

export const FunctionImpl: CloudFunctionImpl<State> = {
    name: "process",
    callFunction,
    cleanup,
    stop,
    getResourceList,
    setConcurrency,
    readLogs
};

async function initialize(serverModule: string, options?: Options): Promise<State> {
    // const bundle = await pack(serverModule, options);
    return Promise.resolve({
        resources: { childProcesses: new Set() },
        callFunnel: new Funnel<FunctionReturn>(),
        logStitcher: new LogStitcher(),
        serverModule
    });
}

async function cleanupResources(_resources: string): Promise<void> {}

async function pack(_functionModule: string, _options?: Options): Promise<PackerResult> {
    throw new Error("Pack not supported for process-cloudify");
}

function getFunctionImpl(): CloudFunctionImpl<State> {
    return FunctionImpl;
}

export interface ProcessFunctionCall {
    call: FunctionCall;
    serverModule: string;
}

function callFunction(state: State, call: FunctionCall): Promise<FunctionReturn> {
    const child = childProcess.fork(require.resolve("./process-trampoline"), undefined, {
        silent: true
    });
    state.resources.childProcesses.add(child);
    const pfCall: ProcessFunctionCall = { call, serverModule: state.serverModule };
    child.send(pfCall);
    return state.callFunnel.push(
        () =>
            new Promise((resolve, reject) => {
                child.on("message", resolve);
                child.on("error", err => {
                    state.resources.childProcesses.delete(child);
                    reject(err);
                });
                child.on("exit", (_code, _signal) => {
                    state.resources.childProcesses.delete(child);
                });
            })
    );
}

async function cleanup(state: State): Promise<void> {
    stop(state);
}

async function stop(state: State): Promise<void> {
    state.callFunnel.clearPending();
}

function getResourceList(_state: State): string {
    return "";
}

async function setConcurrency(
    state: State,
    maxConcurrentExecutions: number
): Promise<void> {
    state.callFunnel.setMaxConcurrency(maxConcurrentExecutions);
}

function readLogs(_state: State): AsyncIterableIterator<LogEntry[]> {
    throw new Error("process_cloudify logs unsupported");
}
