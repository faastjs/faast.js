import * as childProcess from "child_process";
import * as process from "process";
import * as proctor from "process-doctor";
import { inspect } from "util";
import { log } from "./log";
import { Deferred } from "./throttle";
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
    args: any[];
    ResponseQueueId?: string;
}

export interface FunctionReturn extends CallId {
    type: "returned" | "error";
    value?: any;
    isErrorObject?: boolean;
    remoteExecutionStartTime?: number;
    remoteExecutionEndTime?: number;
    logUrl?: string;
    instanceId?: string;
    executionId?: string;
    memoryUsage?: NodeJS.MemoryUsage;
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
): FunctionReturn {
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
        type: "error",
        value: errObj,
        isErrorObject: typeof err === "object" && err instanceof Error,
        callId: call.callId || "",
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
    childDir?: string;
    wrapperVerbose?: boolean;
}

export const WrapperOptionDefaults: Required<WrapperOptions> = {
    wrapperLog: console.log,
    childProcess: true,
    childProcessMemoryLimitMb: 0,
    childProcessTimeoutMs: 0,
    childDir: ".",
    wrapperVerbose: false
};

type CpuUsageCallback = (usage: CpuMeasurement) => void;

const oomPattern = /Allocation failed - JavaScript heap out of memory/;

export class Wrapper {
    executing = false;
    protected verbose = false;
    protected funcs: ModuleType = {};
    protected child?: childProcess.ChildProcess;
    protected log: (msg: string) => void;
    protected deferred?: Deferred<FunctionReturn>;
    readonly options: Required<WrapperOptions>;
    protected monitoringTimer?: NodeJS.Timer;

    constructor(fModule: ModuleType, options: WrapperOptions = {}) {
        this.options = { ...WrapperOptionDefaults, ...options };
        this.log = this.options.wrapperLog;
        this.verbose = this.options.wrapperVerbose;
        this.funcs = fModule;

        if (process.env["FAAST_CHILD"]) {
            this.options.childProcess = false;
            this.log(`faast: started child process for module wrapper.`);
            process.on("message", async (call: FunctionCall) => {
                const startTime = Date.now();
                try {
                    const ret = await this.execute({ call, startTime });
                    process.send!(ret);
                } catch (err) {
                    this.log(err);
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
            this.child.stdout!.removeListener("data", this.logLines);
            this.child.stderr!.removeListener("data", this.logLines);
            this.child!.disconnect();
            this.child!.kill();
            this.child = undefined;
            this.executing = false;
        }
    }

    async execute(
        callingContext: CallingContext,
        callback?: CpuUsageCallback,
        overrideTimeout?: number
    ): Promise<FunctionReturn> {
        try {
            if (this.executing) {
                this.log(`faast: warning: module wrapper execute is not re-entrant`);
                throw new Error(`faast: module wrapper is not re-entrant`);
            }
            this.executing = true;
            this.verbose && this.log(`callingContext: ${inspect(callingContext)}`);
            const memoryUsage = process.memoryUsage();
            const memInfo = inspect(memoryUsage, {
                compact: true,
                breakLength: Infinity
            });
            const { call, startTime, logUrl, executionId, instanceId } = callingContext;
            if (this.options.childProcess) {
                this.deferred = new Deferred();
                if (!this.child) {
                    this.child = this.setupChildProcess();
                }
                this.log(
                    `faast: invoking '${call.name}' in child process, memory: ${memInfo}`
                );
                this.child.send(call, err => {
                    if (err) {
                        log.provider(`child send error: rejecting deferred on ${err}`);
                        this.deferred!.reject(err);
                    }
                });
                if (callback) {
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
                        this.child = undefined;
                        if (this.deferred) {
                            const error = new Error(
                                `Request exceeded timeout of ${timeout}ms`
                            );
                            this.deferred!.reject(error);
                        }
                    }, timeout);
                }
                log.provider(`awaiting deferred promise`);
                try {
                    const rv = await this.deferred.promise;
                    log.provider(`deferred promise returned`);
                    this.verbose &&
                        this.log(`returned from child process: ${inspect(rv)}`);
                    return rv;
                } finally {
                    this.stopCpuMonitoring();
                    timer && clearTimeout(timer);
                    this.deferred = undefined;
                }
            } else {
                this.log(`faast: Invoking '${call.name}', memory: ${memInfo}`);
                const func = this.lookupFunction(call);
                if (!func) {
                    throw new Error(
                        `faast module wrapper: could not find function '${call.name}'`
                    );
                }
                const returned = await func.apply(undefined, call.args);
                this.verbose && this.log(`returned value: ${inspect(returned)}`);

                return {
                    type: "returned",
                    value: returned,
                    callId: call.callId,
                    remoteExecutionStartTime: startTime,
                    remoteExecutionEndTime: Date.now(),
                    logUrl,
                    executionId,
                    memoryUsage,
                    instanceId
                };
            }
        } catch (err) {
            log.provider(`wrapper function exception: ${err}`);
            this.log(`faast: wrapped function exception or promise rejection: ${err}`);
            return createErrorResponse(err, callingContext);
        } finally {
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
            execArgv = process.execArgv.filter(
                arg => !arg.match(/^--max-old-space-size/) && !arg.match(/^--inspect/)
            );
            execArgv.push(
                `--max-old-space-size=${this.options.childProcessMemoryLimitMb}`
            );
        }

        const forkOptions: childProcess.ForkOptions = {
            silent: true, // redirects stdout and stderr to IPC.
            env: { ...process.env, FAAST_CHILD: "true" },
            cwd: this.options.childDir,
            execArgv
        };

        // log.provider(`childProcess.fork %O`, forkOptions);

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
        child.on("message", (value: FunctionReturn) => {
            log.provider(`child message: resolving with %O`, value);
            this.deferred!.resolve(value);
        });
        child.on("error", err => {
            log.provider(`child error: rejecting deferred with ${err}`);
            this.child = undefined;
            this.deferred!.reject(err);
        });
        child.on("exit", (code, signal) => {
            log.provider(`child exit: %O`, { code, signal });
            this.child = undefined;
            if (!this.deferred) {
                log.provider(`child exit: no deferred, exiting normally`);
                return;
            }
            if (code !== null) {
                this.deferred!.reject(new Error(`Exited with error code ${code}`));
            } else if (signal !== null) {
                let errorMessage = `Aborted with signal ${signal}`;
                if (signal === "SIGABRT" && oom) {
                    errorMessage += ` (${oom})`;
                    oom = undefined;
                }
                this.deferred!.reject(new Error(errorMessage));
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
