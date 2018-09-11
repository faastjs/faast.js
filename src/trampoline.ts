import { AnyFunction } from "./type-helpers";
import { deepStrictEqual } from "assert";
import { warn } from "./log";

export interface CallId {
    CallId: string;
}

export interface FunctionCall extends CallId {
    name: string;
    args: any[];
    ResponseQueueId?: string;
}

export interface FunctionReturn extends CallId {
    type: "returned" | "error";
    value?: any;
    remoteExecutionStartTime?: number;
    remoteExecutionEndTime?: number;
}

export interface FunctionReturnWithMetrics {
    returned: FunctionReturn;
    rawResponse: any;
    localRequestSentTime: number;
    remoteResponseSentTime: number;
    localEndTime: number;
    retries?: number;
}

export interface ModuleType {
    [name: string]: AnyFunction;
}

export class ModuleWrapper {
    funcs: ModuleType = {};

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

    createErrorResponse(err: Error, call: FunctionCall, start: number): FunctionReturn {
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
            remoteExecutionStartTime: start,
            remoteExecutionEndTime: Date.now()
        };
    }

    async execute(
        call: FunctionCall,
        remoteExecutionStartTime: number
    ): Promise<FunctionReturn> {
        const func = this.lookupFunction(call);
        try {
            const returned = await func.apply(undefined, call.args);
            const rv: FunctionReturn = {
                type: "returned",
                value: returned,
                CallId: call.CallId,
                remoteExecutionStartTime,
                remoteExecutionEndTime: Date.now()
            };
            return rv;
        } catch (err) {
            return this.createErrorResponse(err, call, remoteExecutionStartTime);
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
        warn(`WARNING: problem serializing arguments to JSON`);
        warn(`deserialized arguments: %O`, deserialized);
        warn(`original arguments: %O`, call);
        warn(
            `Detected function '${
                call.name
            }' argument loses information when serialized by JSON.stringify()`
        );
    }
    return callStr;
}
