import { deepStrictEqual } from "assert";
import * as childProcess from "child_process";
import * as process from "process";
import { inspect } from "util";
import { Deferred } from "./funnel";
import { AnyFunction } from "./type-helpers";
import { logWrapper } from "./log";

export const filename = module.filename;

export interface CallId {
    CallId: string;
}

export interface Trampoline {
    trampoline: AnyFunction;
}

export interface TrampolineFactory {
    filename: string;
    makeTrampoline: (moduleWrapper: ModuleWrapper) => Trampoline;
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

export interface FunctionReturnWithMetrics {
    returned: FunctionReturn;
    rawResponse: any;
    localRequestSentTime: number;
    remoteResponseSentTime?: number;
    localEndTime: number;
}

export interface ModuleType {
    [name: string]: AnyFunction;
}

export function createErrorResponse(
    err: unknown,
    { call, startTime, logUrl, executionId }: CallingContext
): FunctionReturn {
    let errObj: any = err;
    if (err instanceof Error) {
        errObj = {};
        Object.getOwnPropertyNames(err).forEach(name => {
            if (typeof err[name] === "string") {
                errObj[name] = err[name];
            }
        });
    }
    return {
        type: "error",
        value: errObj,
        isErrorObject: typeof err === "object" && err instanceof Error,
        CallId: call.CallId || "",
        remoteExecutionStartTime: startTime,
        remoteExecutionEndTime: Date.now(),
        logUrl,
        executionId
    };
}

export interface ModuleWrapperOptions {
    /**
     * Logging function for console.log/warn/error output. Only available in
     * child process mode. This is mainly useful for debugging the "immediate"
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
}

const oomPattern = /Allocation failed - JavaScript heap out of memory/;

export class ModuleWrapper {
    funcs: ModuleType = {};
    child?: childProcess.ChildProcess;
    deferred?: Deferred<FunctionReturn>;
    log: (msg: string) => void;
    executing = false;

    constructor(fModule: ModuleType, public options: ModuleWrapperOptions = {}) {
        this.log = options.log || console.log;
        this.funcs = fModule;

        if (process.env["CLOUDIFY_CHILD"]) {
            this.log(`cloudify: started child process for module wrapper.`);
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
            this.log(`cloudify: successful cold start.`);
        }
    }

    lookupFunction(request: object): AnyFunction {
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

    stop() {
        if (this.child) {
            this.child!.disconnect();
            this.child!.kill();
        }
    }

    async execute(callingContext: CallingContext): Promise<FunctionReturn> {
        try {
            if (this.executing) {
                this.log(`cloudify: warning: module wrapper execute is not re-entrant`);
                throw new Error(`cloudify: module wrapper is not re-entrant`);
            }
            this.executing = true;

            const memoryUsage = process.memoryUsage();
            const { call, startTime, logUrl, executionId, instanceId } = callingContext;
            if (this.options.useChildProcess) {
                this.deferred = new Deferred();
                if (!this.child) {
                    this.child = this.setupChildProcess();
                }
                this.log(`cloudify: invoking '${call.name}' in child process`);
                this.child.send({ ...call, useChildProcess: false }, err => {
                    if (err) {
                        logWrapper(`child send error: rejecting deferred on ${err}`);
                        this.deferred!.reject(err);
                    }
                });
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
                this.log(`cloudify: Invoking '${call.name}', memory: ${memInfo}`);
                const func = this.lookupFunction(call);
                if (!func) {
                    throw new Error(
                        `cloudify: module wrapper: could not find function '${call.name}'`
                    );
                }
                const returned = await func.apply(undefined, call.args);

                const rv: FunctionReturn = {
                    type: "returned",
                    value: returned,
                    CallId: call.CallId,
                    remoteExecutionStartTime: startTime,
                    remoteExecutionEndTime: Date.now(),
                    logUrl,
                    executionId,
                    memoryUsage,
                    instanceId
                };
                return rv;
            }
        } catch (err) {
            logWrapper(`wrapper function exception: ${err}`);
            this.log(`cloudify: wrapped function exception or promise rejection: ${err}`);
            return createErrorResponse(err, callingContext);
        } finally {
            this.executing = false;
        }
    }

    private setupChildProcess() {
        this.log(`cloudify: creating child process`);

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
            env: { CLOUDIFY_CHILD: "true" },
            cwd: this.options.childDir,
            execArgv
        });

        const logLines = (msg: string) => {
            let lines = msg.split("\n");
            if (lines[lines.length - 1] === "") {
                lines = lines.slice(0, lines.length - 1);
            }
            for (const line of lines) {
                this.log(line);
            }
        };
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");

        let oom: string | undefined;
        const detectOom = (chunk: string) => {
            if (oomPattern.test(chunk)) {
                oom = chunk;
            }
        };
        child.stdout.on("data", logLines);
        child.stderr.on("data", logLines);
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
    function recurse(d: object, s: object) {
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
            `cloudify: Detected '${
                call.name
            }' is not supported because one of its arguments cannot be serialized by JSON.stringify
  original arguments: ${inspect(call.args)}
serialized arguments: ${inspect(deserialized.args)}`
        );
    }
    return callStr;
}
