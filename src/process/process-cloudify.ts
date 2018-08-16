import * as childProcess from "child_process";
import { CloudFunctionImpl, CloudImpl, CommonOptions, LogEntry } from "../cloudify";
import { Funnel } from "../funnel";
import { PackerResult } from "../packer";
import { FunctionCall, FunctionReturn } from "../shared";

export interface ProcessResources {
    childProcesses: Set<childProcess.ChildProcess>;
}

export interface State {
    resources: ProcessResources;
    callFunnel: Funnel<FunctionReturn>;
    serverModule: string;
    logEntries: LogEntry[];
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

async function initialize(serverModule: string, options: Options = {}): Promise<State> {
    // const bundle = await pack(serverModule, options);

    return Promise.resolve({
        resources: { childProcesses: new Set() },
        callFunnel: new Funnel<FunctionReturn>(),
        serverModule,
        logEntries: []
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
    const child = childProcess.fork(require.resolve("./process-trampoline"), [], {
        silent: true
    });
    state.resources.childProcesses.add(child);

    function appendLog(chunk: string) {
        if (state.logEntries.length > 5000) {
            state.logEntries.splice(0, 1000);
        }
        state.logEntries.push({ message: chunk, timestamp: Date.now() });
    }
    child.stdout.on("data", appendLog);
    child.stderr.on("data", appendLog);

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
    return stop(state);
}

async function stop(state: State): Promise<void> {
    state.callFunnel.clearPending();
    const childProcesses = state.resources.childProcesses;
    const completed = Promise.all(
        [...childProcesses].map(p => new Promise(resolve => p.on("exit", resolve)))
    );
    childProcesses.forEach(p => p.kill());
    await completed;
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

async function* readLogs(state: State): AsyncIterableIterator<LogEntry[]> {
    const entries = state.logEntries;
    state.logEntries = [];
    if (entries.length > 0) {
        yield entries;
    }
}
