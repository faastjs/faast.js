import { Request, Response } from "express";
import humanStringify from "human-stringify";
import { FunctionCall, FunctionReturn } from "./cloudify";

export interface FunctionEntry {
    name: string;
    fn: Function;
}

export type AnyFunction = (...args: any[]) => any;

const funcs: FunctionEntry[] = [];

function validate(request: Request): FunctionCall {
    // XXX
    return request.body;
}

export function registerFunction<A, R>(fn: (arg: A) => R, name?: string) {
    name = name || fn.name;
    if (!name) {
        throw new Error("Could not register function without name");
    }
    funcs[name] = fn;
}

export async function trampoline(request: Request, response: Response) {
    try {
        const call = validate(request);
        if (!call) {
            throw new Error("Invalid function call request");
        }

        const fn = funcs[call.name];
        if (!fn) {
            throw new Error(`Function named "${call.name}" not found`);
        }

        console.log(`Args: ${humanStringify(call.args)}`);

        const rv = await fn.call(undefined, call.args);

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
