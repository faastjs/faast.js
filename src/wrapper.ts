import { deepStrictEqual } from "assert";
import * as childProcess from "child_process";
import * as process from "process";
import * as proctor from "process-doctor";
import { inspect } from "util";
import { logWrapper } from "./log";
import { Deferred } from "./throttle";
import { AnyFunction } from "./types";
import { EventEmitter } from "events";

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
    [name: string]: AnyFunction;
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
    log?: (msg: string) => void;
    /**
     * If true, create a child process to execute the wrapped module's functions.
     */
    useChildProcess?: boolean;

    childProcessMemoryLimitMb?: number;
    childProcessTimeout?: number;
    childDir?: string;
    verbose?: boolean;
}

type CpuUsageCallback = (err?: Error, usage?: CpuMeasurement) => void;

const oomPattern = /Allocation failed - JavaScript heap out of memory/;

export class Wrapper {
    executing = false;
    protected verbose = false;
    protected funcs: ModuleType = {};
    protected child?: childProcess.ChildProcess;
    protected log: (msg: string) => void;
    protected deferred?: Deferred<FunctionReturn>;
    protected emitter = new EventEmitter();

    constructor(fModule: ModuleType, public options: WrapperOptions = {}) {
        this.log = options.log || console.log;
        this.verbose = options.verbose || false;
        this.funcs = fModule;

        if (process.env["FAAST_CHILD"]) {
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
            if (options.useChildProcess) {
                this.child = this.setupChildProcess();
            }
            this.log(`faast: successful cold start.`);
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

    protected cpuMeasurementTimer: NodeJS.Timer | undefined;

    protected stopCpuMonitoring() {
        this.emitter.removeAllListeners();
        this.cpuMeasurementTimer && clearInterval(this.cpuMeasurementTimer);
        this.cpuMeasurementTimer = undefined;
    }

    protected ensureCpuMonitoring() {
        if (!this.cpuMeasurementTimer && this.child) {
            this.cpuMeasurementTimer = cpuMonitor(this.child.pid, 1000, (err, result) =>
                this.emitter.emit("cpuUsage", err, result)
            );
        }
    }

    stop() {
        this.stopCpuMonitoring();
        if (this.child) {
            this.child.stdout.removeListener("data", this.logLines);
            this.child.stderr.removeListener("data", this.logLines);
            this.child!.disconnect();
            this.child!.kill();
            this.child = undefined;
        }
    }

    async execute(callingContext: CallingContext): Promise<FunctionReturn> {
        try {
            if (this.executing) {
                this.log(`faast: warning: module wrapper execute is not re-entrant`);
                throw new Error(`faast: module wrapper is not re-entrant`);
            }
            this.executing = true;
            this.verbose && this.log(`callingContext: ${inspect(callingContext)}`);
            const memoryUsage = process.memoryUsage();
            const { call, startTime, logUrl, executionId, instanceId } = callingContext;
            if (this.options.useChildProcess) {
                this.deferred = new Deferred();
                if (!this.child) {
                    this.child = this.setupChildProcess();
                }
                this.log(`faast: invoking '${call.name}' in child process`);
                this.child.send({ ...call, useChildProcess: false }, err => {
                    if (err) {
                        logWrapper(`child send error: rejecting deferred on ${err}`);
                        this.deferred!.reject(err);
                    }
                });
                this.ensureCpuMonitoring();

                let timer;
                const timeout = this.options.childProcessTimeout;
                if (timeout) {
                    timer = setTimeout(() => {
                        this.stop();
                        this.child = undefined;
                        if (this.deferred) {
                            const error = new Error(
                                `Request exceeded timeout of ${timeout}s`
                            );
                            this.deferred!.reject(error);
                        }
                    }, timeout * 1000);
                }
                logWrapper(`awaiting deferred promise`);
                try {
                    const rv = await this.deferred.promise;
                    logWrapper(`deferred promise returned`);
                    this.verbose &&
                        this.log(`returned from child process: ${inspect(rv)}`);
                    return rv;
                } finally {
                    timer && clearTimeout(timer);
                    this.deferred = undefined;
                }
            } else {
                const memInfo = inspect(memoryUsage, {
                    compact: true,
                    breakLength: Infinity
                });
                this.log(`faast: Invoking '${call.name}', memory: ${memInfo}`);
                const func = this.lookupFunction(call);
                if (!func) {
                    throw new Error(
                        `faast: module wrapper: could not find function '${call.name}'`
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
            logWrapper(`wrapper function exception: ${err}`);
            this.log(`faast: wrapped function exception or promise rejection: ${err}`);
            return createErrorResponse(err, callingContext);
        } finally {
            this.stopCpuMonitoring();
            this.executing = false;
        }
    }

    on(event: "cpuUsage", callback: CpuUsageCallback) {
        const rv = this.emitter.on(event, callback);
        this.ensureCpuMonitoring();
        return rv;
    }

    off(event: "cpuUsage", callback: CpuUsageCallback) {
        const rv = this.emitter.off(event, callback);
        if (this.emitter.listenerCount(event) === 0 && this.cpuMeasurementTimer) {
            this.stopCpuMonitoring();
        }
        return rv;
    }

    protected logLines = (msg: string) => {
        let lines = msg.split("\n");
        if (lines[lines.length - 1] === "") {
            lines = lines.slice(0, lines.length - 1);
        }
        for (const line of lines) {
            this.log(line);
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

        const child = childProcess.fork("./index.js", [], {
            silent: true, // redirects stdout and stderr to IPC.
            env: { FAAST_CHILD: "true" },
            cwd: this.options.childDir,
            execArgv
        });

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");

        let oom: string | undefined;
        const detectOom = (chunk: string) => {
            if (oomPattern.test(chunk)) {
                oom = chunk;
            }
        };
        child.stdout.on("data", this.logLines);
        child.stderr.on("data", this.logLines);
        child.stderr.on("data", detectOom);
        child.on("message", (value: FunctionReturn) => {
            logWrapper(`child message: resolving with %O`, value);
            this.deferred!.resolve(value);
        });
        child.on("error", err => {
            logWrapper(`child error: rejecting deferred with ${err}`);
            this.child = undefined;
            this.deferred!.reject(err);
        });
        child.on("exit", (code, signal) => {
            logWrapper(`child exit: %O`, { code, signal });
            this.child = undefined;
            if (!this.deferred) {
                logWrapper(`child exit: no deferred, exiting normally`);
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

export function deepCopyUndefined(dest: object, source: object) {
    const stack: object[] = [];
    function isBackReference(o: object) {
        for (const elem of stack) {
            if (elem === o) {
                return true;
            }
        }
        return false;
    }
    function recurse(d: any, s: any) {
        if (isBackReference(s) || d === undefined) {
            return;
        }
        stack.push(s);
        Object.keys(s).forEach(key => {
            if (s[key] && typeof s[key] === "object") {
                recurse(d[key], s[key]);
            } else if (s[key] === undefined) {
                d[key] = undefined;
            }
        });
        stack.pop();
    }
    typeof source === "object" && recurse(dest, source);
}

export function serializeCall(call: FunctionCall) {
    const callStr = JSON.stringify(call);
    const deserialized = JSON.parse(callStr);
    deepCopyUndefined(deserialized, call);
    try {
        deepStrictEqual(deserialized, call);
    } catch (_) {
        throw new Error(
            `faast: Detected '${
                call.name
            }' is not supported because one of its arguments cannot be serialized by JSON.stringify
  original arguments: ${inspect(call.args)}
serialized arguments: ${inspect(deserialized.args)}`
        );
    }
    return callStr;
}

export function serializeReturn(returned: FunctionReturn) {
    const rv = JSON.stringify(returned);
    const deserialized = JSON.parse(rv);
    deepCopyUndefined(deserialized.value, returned.value);
    try {
        deepStrictEqual(deserialized.value, returned.value);
    } catch (err) {
        throw new Error(
            `faast: Detected call '${
                returned.value
            }' is not supported because one of its arguments cannot be serialized by JSON.stringify
  original arguments: ${inspect(returned.value)}
serialized arguments: ${inspect(deserialized.value)}`
        );
    }
    return rv;
}

export type CpuMeasurement = Pick<proctor.Result, "time" | "stime" | "utime">;

function diffCpu(next: CpuMeasurement, prev?: CpuMeasurement): CpuMeasurement {
    if (!prev) {
        prev = {
            time: 0,
            stime: 0,
            utime: 0
        };
    }
    return {
        time: next.time - prev.time,
        stime: next.stime - prev.stime,
        utime: next.utime - prev.utime
    };
}

function cpuMonitor(
    pid: number,
    interval: number,
    callback: (err?: Error, result?: CpuMeasurement) => void
) {
    let prev: CpuMeasurement | undefined;
    const timer = setInterval(
        () =>
            proctor.lookup(pid, (err, result) => {
                callback(err, result && diffCpu(result, prev));
                if (result) {
                    prev = result;
                }
            }),
        interval
    );
    return timer;
}
