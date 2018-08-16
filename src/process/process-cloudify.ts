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
    options: Options;
}

export interface Options extends CommonOptions {}

export const defaults = {
    timeout: 60,
    memorySize: 256
};

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
    return Promise.resolve({
        resources: { childProcesses: new Set() },
        callFunnel: new Funnel<FunctionReturn>(),
        serverModule,
        logEntries: [],
        options
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
    timeout: number;
}

const oomPattern = /Allocation failed - JavaScript heap out of memory/;

function callFunction(state: State, call: FunctionCall): Promise<FunctionReturn> {
    let oom: string;

    function setupLogForwarding(child: childProcess.ChildProcess) {
        function appendLog(chunk: string) {
            if (state.logEntries.length > 5000) {
                state.logEntries.splice(0, 1000);
            }
            if (oomPattern.test(chunk)) {
                oom = chunk;
            }
            state.logEntries.push({ message: chunk, timestamp: Date.now() });
        }
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", appendLog);

        child.stdout.setEncoding("utf8");
        child.stdout.on("data", appendLog);
    }

    const {
        memorySize = defaults.memorySize,
        timeout = defaults.timeout
    } = state.options;
    const execArgv = process.execArgv.filter(arg => !arg.match(/--max-old-space-size/));
    execArgv.push(`--max-old-space-size=${memorySize}`);
    const trampolineModule = require.resolve("./process-trampoline");
    return state.callFunnel.push(
        () =>
            new Promise((resolve, reject) => {
                const child = childProcess.fork(trampolineModule, [], {
                    silent: true,
                    execArgv
                });
                state.resources.childProcesses.add(child);
                setupLogForwarding(child);

                const pfCall: ProcessFunctionCall = {
                    call,
                    serverModule: state.serverModule,
                    timeout
                };

                child.send(pfCall);

                child.on("message", resolve);
                child.on("error", err => {
                    state.resources.childProcesses.delete(child);
                    reject(err);
                });
                child.on("exit", (code, signal) => {
                    state.resources.childProcesses.delete(child);
                    if (code) {
                        reject(new Error(`Exited with error code ${code}`));
                    } else if (signal) {
                        let errorMessage = `Aborted with signal ${signal}`;
                        if (signal === "SIGABRT" && oom) {
                            errorMessage += ` (${oom})`;
                        }
                        reject(new Error(errorMessage));
                    }
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
