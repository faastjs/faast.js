import { AnyFunction } from "./type-helpers";
import { deepStrictEqual } from "assert";
import * as childProcess from "child_process";
import { inspect } from "util";
import { Deferred } from "./funnel";

export interface CallId {
    CallId: string;
}

export interface Trampoline {
    trampoline: AnyFunction;
    moduleWrapper: ModuleWrapper;
}

export interface FunctionCall extends CallId {
    name: string;
    modulePath: string;
    args: any[];
    ResponseQueueId?: string;
    childProcess?: boolean;
}

export interface FunctionReturn extends CallId {
    type: "returned" | "error";
    value?: any;
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
    err: Error,
    { call, startTime, logUrl, executionId }: CallingContext
): FunctionReturn {
    const errObj = {};
    Object.getOwnPropertyNames(err).forEach(name => {
        if (typeof err[name] === "string") {
            errObj[name] = err[name];
        }
    });
    return {
        type: "error",
        value: errObj,
        CallId: call.CallId || "",
        remoteExecutionStartTime: startTime,
        remoteExecutionEndTime: Date.now(),
        logUrl,
        executionId
    };
}

export class ModuleWrapper {
    funcs: ModuleType = {};
    verbose: boolean;
    child?: childProcess.ChildProcess;
    deferred?: Deferred<FunctionReturn>;

    constructor(public parentFilename: string, { verbose = true } = {}) {
        this.verbose = verbose;
        if (verbose) {
            console.log(`cloudify: successful cold start.`);
        }
    }

    register(moduleObj: ModuleType) {
        this.funcs = moduleObj;
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

    async execute(callingContext: CallingContext): Promise<FunctionReturn> {
        try {
            const memoryUsage = process.memoryUsage();
            const { call, startTime, logUrl, executionId, instanceId } = callingContext;
            if (call.childProcess) {
                this.deferred = new Deferred();
                if (!this.child) {
                    this.verbose && console.log(`Creating child process`);
                    this.child = childProcess.fork("./child-index.js", [], {
                        silent: true
                    });
                    // this.child.stdout.pipe(process.stdout);
                    // this.child.stderr.pipe(process.stderr);
                    this.child.stdout.setEncoding("utf8");
                    this.child.stderr.setEncoding("utf8");

                    this.child.stdout.on("data", console.error);
                    this.child.stderr.on("data", console.error);

                    this.child.on("message", (value: FunctionReturn) =>
                        this.deferred!.resolve(value)
                    );
                    this.child.on("error", err => {
                        this.child = undefined;
                        this.deferred!.reject(err);
                    });
                    this.child.on("exit", (code, signal) => {
                        this.child = undefined;
                        if (code) {
                            this.deferred!.reject(
                                new Error(`Exited with error code ${code}`)
                            );
                        } else if (signal) {
                            this.deferred!.reject(
                                new Error(`Aborted with signal ${signal}`)
                            );
                        }
                    });
                }
                this.verbose && console.log(`Sending request to child process`);
                this.child.send(
                    { ...call, childProcess: false },
                    err => err && this.deferred!.reject(err)
                );
                this.deferred!.promise.then(_ => (this.deferred = undefined));
                return this.deferred.promise;
            } else {
                const memInfo = inspect(memoryUsage, { compact: true });
                this.verbose &&
                    console.log(`cloudify: Invoking '${call.name}', memory: ${memInfo}`);
                const func = this.lookupFunction(call);
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
            console.error(`Caught error in moduleWrapper.execute`);
            this.verbose && console.error(err);
            return createErrorResponse(err, callingContext);
        }
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
        console.warn(`WARNING: problem serializing arguments to JSON`);
        console.warn(`deserialized arguments: %O`, deserialized);
        console.warn(`original arguments: %O`, call);
        console.warn(
            `Detected function '${
                call.name
            }' argument loses information when serialized by JSON.stringify()`
        );
    }
    return callStr;
}
