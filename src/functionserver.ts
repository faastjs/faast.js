import { Request, Response } from "express";
import humanStringify from "human-stringify";

export interface FunctionCall {
    name: string;
    args: any[];
}

export interface FunctionReturn {
    type: "returned" | "error";
    message?: string;
    value?: any;
}

export type AnyFunction = (...args: any[]) => any;

const funcs: { [func: string]: AnyFunction } = {};

export function registerFunction(fn: (...args: any[]) => any, name?: string) {
    name = name || fn.name;
    if (!name) {
        throw new Error("Could not register function without name");
    }
    funcs[name] = fn;
}

export async function trampoline(request: Request, response: Response) {
    try {
        const call = request.body as FunctionCall;
        console.log(`BODY: ${humanStringify(call)}`);
        if (!call) {
            throw new Error("Invalid function call request");
        }

        const func = funcs[call.name];
        if (!func) {
            throw new Error(`Function named "${call.name}" not found`);
        }

        if (!call.args || !call.args.length) {
            throw new Error("Invalid arguments to function call");
        }

        const rv = await func.apply(undefined, call.args);

        response.send({
            type: "returned",
            value: rv
        } as FunctionReturn);
    } catch (err) {
        response.send({
            type: "error",
            message: err.stack
        } as FunctionReturn);
    }
}
