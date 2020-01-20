import * as childProcess from "child_process";
import * as process from "process";
import * as proctor from "process-doctor";
import { inspect } from "util";
import { Message, ResponseMessage } from "./provider";
import { deserialize, serializeReturnValue } from "./serialize";
import { AsyncQueue } from "./throttle";
import { AnyFunction } from "./types";

export const filename = module.filename;

export interface CallId {
    callId: string;
}

export interface Trampoline {
    trampoline: AnyFunction;
}

export interface TrampolineFactory {
    filename: string;
    makeTrampoline: (wrapper: Wrapper) => Trampoline;
}

export interface FunctionCall extends CallId {
    name: string;
    modulePath: string;
    args: string;
    ResponseQueueId?: string;
}

export interface CallingContext {
    call: FunctionCall;
    startTime: number;
    logUrl?: string;
    executionId?: string;
    instanceId?: string;
}

export interface ModuleType {
    [name: string]: any;
}

export function createErrorResponse(
    err: any,
    { call, startTime, logUrl, executionId }: CallingContext
): ResponseMessage {
    let errObj: any = err;
    if (err instanceof Error) {
        errObj = {};
        Object.getOwnPropertyNames(err).forEach(name => {
            if (typeof (err as any)[name] === "string") {
                errObj[name] = (err as any)[name];
            }
        });
    }
    return {
        kind: "response",
        type: "error",
        value: serializeReturnValue(call.name, errObj, false),
        isErrorObject: typeof err === "object" && err instanceof Error,
        callId: call.callId,
        remoteExecutionStartTime: startTime,
        remoteExecutionEndTime: Date.now(),
        logUrl,
        executionId
    };
}

export interface WrapperOptions {
    /**
     * Logging function for console.log/warn/error output. Only available in
     * child process mode. This is mainly useful for debugging the "local"
     * mode which runs code locally. In real clouds the logs will end up in the
     * cloud logging service (e.g. Cloudwatch Logs, or Google Stackdriver logs).
     * Defaults to console.log.
     */
    wrapperLog?: (msg: string) => void;
    childProcess?: boolean;
    childProcessMemoryLimitMb?: number;
    childProcessTimeoutMs?: number;
    childProcessEnvironment?: { [key: string]: string };
    childDir?: string;
    wrapperVerbose?: boolean;
    validateSerialization?: boolean;
}

export const WrapperOptionDefaults: Required<WrapperOptions> = {
    wrapperLog: console.log,
    childProcess: true,
    childProcessMemoryLimitMb: 0,
    childProcessTimeoutMs: 0,
    childProcessEnvironment: {},
    childDir: ".",
    wrapperVerbose: false,
    validateSerialization: true
};

type CpuUsageCallback = (usage: CpuMeasurement) => void;
type ErrorCallback = (err: Error) => Error;

export interface WrapperExecuteOptions {
    overrideTimeout?: number;
    onCpuUsage?: CpuUsageCallback;
    errorCallback?: ErrorCallback;
}

const oomPattern = /Allocation failed - JavaScript heap out of memory/;

const FAAST_CHILD_ENV = "FAAST_CHILD";

export class Wrapper {
    executing = false;
    protected verbose = false;
    protected funcs: ModuleType = {};
    protected child?: childProcess.ChildProcess;
    protected log: (msg: string) => void;
    protected queue: AsyncQueue<Message>;
    readonly options: Required<WrapperOptions>;
    protected monitoringTimer?: NodeJS.Timer;

    constructor(fModule: ModuleType, options: WrapperOptions = {}) {
        this.options = { ...WrapperOptionDefaults, ...options };
        this.log = this.options.wrapperLog;
        this.verbose = this.options.wrapperVerbose;
        this.funcs = fModule;
        this.queue = new AsyncQueue();

        /* istanbul ignore if  */
        if (process.env[FAAST_CHILD_ENV]) {
            this.options.childProcess = false;
            this.log(`faast: started child process for module wrapper.`);
            process.on("message", async (call: FunctionCall) => {
                const startTime = Date.now();
                try {
                    for await (const next of this.execute({ call, startTime })) {
                        this.log(`Received message ${next.kind}`);
                        process.send!({ done: false, value: next });
                    }
                    this.log(`Done with this.execute()`);
                } catch (err) {
                    this.log(err);
                } finally {
                    process.send!({ done: true });
                }
            });
        } else {
            if (!process.env.FAAST_SILENT) {
                this.log(`faast: successful cold start.`);
            }
        }
    }

    protected lookupFunction(request: object): AnyFunction {
        const { name, args } = request as FunctionCall;
        if (!name) {
            throw new Error("Invalid function call request: no name");
        }

        const func = this.funcs[name];
        if (!func) {
            throw new Error(`Function named "${name}" not found`);
        }

        if (!args) {
            throw new Error("Invalid arguments to function call");
        }
        return func;
    }

    protected stopCpuMonitoring() {
        this.monitoringTimer && clearInterval(this.monitoringTimer);
        this.monitoringTimer = undefined;
    }

    protected startCpuMonitoring(pid: number, callback: CpuUsageCallback) {
        if (this.monitoringTimer) {
            this.stopCpuMonitoring();
        }
        this.monitoringTimer = cpuMonitor(pid, 1000, (err, result) => {
            if (err) {
                this.log(`cpu monitor error: ${err}`);
            }
            if (result) {
                callback(result);
            }
        });
    }

    stop() {
        this.stopCpuMonitoring();
        if (this.child) {
            this.log(`Stopping child process.`);
            this.child.stdout!.removeListener("data", this.logLines);
            this.child.stderr!.removeListener("data", this.logLines);
            this.child!.disconnect();
            this.child!.kill();
            this.child = undefined;
            this.executing = false;
        }
    }

    async *execute(
        callingContext: CallingContext,
        {
            onCpuUsage: cpuUsageCallback,
            overrideTimeout,
            errorCallback
        }: WrapperExecuteOptions = {}
    ): AsyncGenerator<Message> {
        try {
            /* istanbul ignore if  */
            if (this.executing) {
                this.log(`faast: warning: module wrapper execute is not re-entrant`);
                throw new Error(`faast: module wrapper is not re-entrant`);
            }
            this.executing = true;
            const { call, startTime, logUrl, executionId, instanceId } = callingContext;
            const { callId } = call;
            if (this.verbose) {
                this.log(`calling: ${call.name}`);
                this.log(`   args: ${call.args}`);
                this.log(`   callId: ${callId}`);
            }
            const memoryUsage = process.memoryUsage();
            const memInfo = inspect(memoryUsage, {
                compact: true,
                breakLength: Infinity
            });
            if (this.options.childProcess) {
                if (!this.child) {
                    this.child = this.setupChildProcess();
                }
                this.log(
                    `faast: invoking '${call.name}' in child process, memory: ${memInfo}`
                );
                this.child.send(call, err => {
                    /* istanbul ignore if  */
                    if (err) {
                        this.log(`child send error: rejecting with ${err}`);
                        this.queue.enqueue(Promise.reject(err));
                    }
                });
                if (cpuUsageCallback) {
                    this.log(`Starting CPU monitor for pid ${this.child.pid}`);
                    // XXX CPU Monitoring not enabled for now.
                    // this.startCpuMonitoring(this.child.pid, callback);
                }

                let timer;
                const timeout =
                    overrideTimeout !== undefined
                        ? overrideTimeout
                        : this.options.childProcessTimeoutMs;
                if (timeout) {
                    timer = setTimeout(() => {
                        this.stop();
                        const error = new Error(
                            `Request exceeded timeout of ${timeout}ms`
                        );
                        this.queue.enqueue(Promise.reject(error));
                    }, timeout);
                }
                this.log(`awaiting async dequeue`);
                try {
                    for await (const result of this.queue) {
                        this.log(`Dequeuing ${inspect(result)}`);
                        if (result.kind === "response") {
                            result.logUrl = logUrl;
                        }
                        yield result;
                    }
                } finally {
                    this.log(`Finalizing queue`);
                    this.stopCpuMonitoring();
                    timer && clearTimeout(timer);
                    this.queue.clear();
                }
            } else {
                this.log(`faast: Invoking '${call.name}', memory: ${memInfo}`);
                const func = this.lookupFunction(call);
                if (!func) {
                    throw new Error(
                        `faast module wrapper: could not find function '${call.name}'`
                    );
                }
                const args = deserialize(call.args);
                let value;
                try {
                    value = await func.apply(undefined, args);
                    this.log(`Finished call function`);
                } catch (err) {
                    this.log(`caught error`);
                    this.log(`${err}`);
                    throw err;
                }
                this.verbose &&
                    this.log(`returned value: ${inspect(value)}, type: ${typeof value}`);

                const validate = this.options.validateSerialization;

                // Check for iterable.
                // let isIterator = false;
                // if (value !== null && value !== undefined) {
                //     if (
                //         typeof value === "object" &&
                //         typeof value["next"] === "function"
                //     ) {
                //         isIterator = true;
                //         for await (const next of value) {
                //             yield {
                //                 kind: "response",
                //                 callId,
                //                 type: "yield",
                //                 value: serializeReturnValue(call.name, [next], validate),
                //                 logUrl,
                //                 executionId,
                //                 instanceId
                //             };
                //         }
                //         value = undefined;
                //     }
                // }

                yield {
                    kind: "response",
                    callId,
                    type: "returned",
                    value: serializeReturnValue(call.name, [value], validate),
                    remoteExecutionStartTime: startTime,
                    remoteExecutionEndTime: Date.now(),
                    logUrl,
                    executionId,
                    memoryUsage,
                    instanceId
                };
            }
        } catch (origError) {
            const err =
                errorCallback && origError instanceof Error
                    ? errorCallback(origError)
                    : origError;
            this.log(`faast: wrapped function exception or promise rejection: ${err}`);
            yield createErrorResponse(err, callingContext);
        } finally {
            this.log(`Exiting execute`);
            this.executing = false;
        }
    }

    protected logLines = (msg: string) => {
        let lines = msg.split("\n");
        if (lines[lines.length - 1] === "") {
            lines = lines.slice(0, lines.length - 1);
        }
        for (const line of lines) {
            this.log(`[${this.child!.pid}]: ${line}`);
        }
    };

    protected setupChildProcess() {
        this.log(`faast: creating child process`);

        let execArgv = process.execArgv.slice();
        if (this.options.childProcessMemoryLimitMb) {
            /* istanbul ignore next  */
            execArgv = process.execArgv.filter(
                arg => !arg.match(/^--max-old-space-size/) && !arg.match(/^--inspect/)
            );
            execArgv.push(
                `--max-old-space-size=${this.options.childProcessMemoryLimitMb}`
            );
        }

        const { childProcessEnvironment } = this.options;
        const env = { ...process.env, ...childProcessEnvironment, FAAST_CHILD: "true" };
        this.verbose && this.log(`Env: ${JSON.stringify(env)}`);
        const forkOptions: childProcess.ForkOptions = {
            silent: true, // redirects stdout and stderr to IPC.
            env,
            cwd: this.options.childDir,
            execArgv
        };

        const child = childProcess.fork("./index.js", [], forkOptions);

        child.stdout!.setEncoding("utf8");
        child.stderr!.setEncoding("utf8");

        let oom: string | undefined;
        const detectOom = (chunk: string) => {
            if (oomPattern.test(chunk)) {
                oom = chunk;
            }
        };
        child.stdout!.on("data", this.logLines);
        child.stderr!.on("data", this.logLines);
        child.stderr!.on("data", detectOom);
        child.on("message", (message: IteratorResult<Message>) => {
            this.log(`child message: resolving with ${inspect(message)}`);
            if (message.done) {
                this.queue.done();
            } else {
                this.queue.enqueue(message.value);
            }
        });
        /* istanbul ignore next  */
        child.on("error", err => {
            this.log(`child error: rejecting with ${err}`);
            this.child = undefined;
            this.queue.enqueue(Promise.reject(err));
        });
        child.on("exit", (code, signal) => {
            this.log(`child exit: code: ${code}, signal: ${signal}`);
            this.child = undefined;
            if (code) {
                this.queue.enqueue(
                    Promise.reject(new Error(`Exited with error code ${code}`))
                );
            } else if (signal !== null && signal !== "SIGTERM") {
                let errorMessage = `Aborted with signal ${signal}`;
                if (signal === "SIGABRT" && oom) {
                    errorMessage += ` (${oom})`;
                    oom = undefined;
                }
                this.queue.enqueue(Promise.reject(new Error(errorMessage)));
            } else {
                this.log(`child exiting normally`);
            }
        });
        return child;
    }
}

export interface CpuMeasurement {
    stime: number;
    utime: number;
    elapsed: number;
}

function cpuMonitor(
    pid: number,
    interval: number,
    callback: (err?: Error, result?: CpuMeasurement) => void
) {
    const start = Date.now();
    const timer = setInterval(
        () =>
            proctor.lookup(pid, (err, result) => {
                if (err) {
                    callback(err);
                    return;
                }
                const { stime, utime } = result;
                callback(
                    err,
                    result && {
                        stime: stime * 10,
                        utime: utime * 10,
                        elapsed: Date.now() - start
                    }
                );
            }),
        interval
    );
    return timer;
}
