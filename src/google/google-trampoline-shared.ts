import { FunctionCall, FunctionReturn } from "../shared";
import { AnyFunction } from "../type-helpers";

const funcs: { [func: string]: AnyFunction } = {};

export function registerFunction(fn: AnyFunction, name?: string) {
    name = name || fn.name;
    if (!name) {
        throw new Error("Could not register function without name");
    }
    funcs[name] = fn;
}

export function registerAllFunctions(obj: { [name: string]: AnyFunction }) {
    for (const name of Object.keys(obj)) {
        registerFunction(obj[name], name);
    }
}

export interface ParsedFunc {
    func: AnyFunction;
    args: any[];
    CallId: string;
    ResponseQueueId?: string;
}

export function parseFunc(body: object): ParsedFunc {
    const { name, args, CallId, ResponseQueueId } = body as FunctionCall;
    if (!name) {
        throw new Error("Invalid function call request: no name");
    }

    const func = funcs[name];
    if (!func) {
        throw new Error(`Function named "${name}" not found`);
    }

    if (!args) {
        throw new Error("Invalid arguments to function call");
    }
    return { func, args, CallId, ResponseQueueId };
}

export function createErrorResponse(
    err: Error,
    CallId: string | undefined,
    executionStart: number
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
        CallId: CallId || "",
        executionStart,
        executionEnd: Date.now()
    };
}

export async function callFunc(parsedFunc: ParsedFunc, executionStart: number) {
    const { func, args, CallId } = parsedFunc;
    const returned = await func.apply(undefined, args);
    const rv: FunctionReturn = {
        type: "returned",
        value: returned,
        CallId,
        executionStart,
        executionEnd: Date.now()
    };
    return rv;
}
