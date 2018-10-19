import * as childProcess from "child_process";
import { CloudFunctionImpl, CloudImpl, CommonOptions } from "../cloudify";
import { Funnel } from "../funnel";
import { PackerResult } from "../packer";
import {
    FunctionCall,
    FunctionReturn,
    FunctionReturnWithMetrics,
    createErrorResponse
} from "../trampoline";

export interface ProcessResources {
    childProcesses: Set<childProcess.ChildProcess>;
}

export interface State {
    resources: ProcessResources;
    callFunnel: Funnel<FunctionReturnWithMetrics>;
    serverModule: string;
    options: Options;
}

export type Logger = (msg: string) => void;

export interface Options extends CommonOptions {
    logger?: Logger;
}

export const defaults = {
    timeout: 60,
    memorySize: 256,
    concurrency: 500
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
    setConcurrency
};

async function initialize(serverModule: string, options: Options = {}): Promise<State> {
    const { concurrency = defaults.concurrency } = options;
    return {
        resources: { childProcesses: new Set() },
        callFunnel: new Funnel<FunctionReturnWithMetrics>(concurrency),
        serverModule,
        options
    };
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

function callFunction(
    state: State,
    call: FunctionCall
): Promise<FunctionReturnWithMetrics> {
    let oom: string;

    function setupLoggers(child: childProcess.ChildProcess) {
        function detectOom(chunk: string) {
            if (oomPattern.test(chunk)) {
                oom = chunk;
            }
        }
        child.stderr.setEncoding("utf8");
        child.stdout.setEncoding("utf8");

        child.stderr.on("data", detectOom);

        if (state.options.logger) {
            child.stdout.on("data", state.options.logger);
            child.stderr.on("data", state.options.logger);
        }
    }

    const {
        memorySize = defaults.memorySize,
        timeout = defaults.timeout
    } = state.options;
    const execArgv = process.execArgv.filter(
        arg => !arg.match(/^--max-old-space-size/) && !arg.match(/^--inspect/)
    );
    execArgv.push(`--max-old-space-size=${memorySize}`);
    const trampolineModule = require.resolve("./childprocess-trampoline");
    return state.callFunnel.push(
        () =>
            new Promise(resolve => {
                const child = childProcess.fork(trampolineModule, [], {
                    silent: true,
                    execArgv
                });
                state.resources.childProcesses.add(child);
                setupLoggers(child);

                const pfCall: ProcessFunctionCall = {
                    call,
                    serverModule: state.serverModule,
                    timeout
                };

                const localRequestSentTime = Date.now();
                child.send(pfCall);

                child.on("message", (returned: FunctionReturn) =>
                    resolve({
                        returned,
                        localRequestSentTime,
                        rawResponse: {},
                        remoteResponseSentTime: returned.remoteExecutionEndTime!,
                        localEndTime: Date.now()
                    })
                );
                child.on("error", err => {
                    state.resources.childProcesses.delete(child);
                    resolve({
                        returned: createErrorResponse(err, call, localRequestSentTime),
                        rawResponse: {},
                        localRequestSentTime,
                        localEndTime: Date.now()
                    });
                });
                child.on("exit", (code, signal) => {
                    state.resources.childProcesses.delete(child);
                    let err;
                    if (code) {
                        err = new Error(`Exited with error code ${code}`);
                    } else if (signal) {
                        let errorMessage = `Aborted with signal ${signal}`;
                        if (signal === "SIGABRT" && oom) {
                            errorMessage += ` (${oom})`;
                        }
                        err = new Error(errorMessage);
                    }
                    if (err) {
                        resolve({
                            returned: createErrorResponse(
                                err,
                                call,
                                localRequestSentTime
                            ),
                            rawResponse: {},
                            localRequestSentTime,
                            localEndTime: Date.now()
                        });
                    }
                });
            })
    );
}

async function cleanup(state: State): Promise<void> {
    await stop(state);
}

async function stop(state: State): Promise<string> {
    state.callFunnel.clear();
    const childProcesses = state.resources.childProcesses;
    const completed = Promise.all(
        [...childProcesses].map(p => new Promise(resolve => p.on("exit", resolve)))
    );
    childProcesses.forEach(p => p.kill());
    await completed;
    return "";
}

async function setConcurrency(
    state: State,
    maxConcurrentExecutions: number
): Promise<void> {
    state.callFunnel.setMaxConcurrency(maxConcurrentExecutions);
}
