import humanStringify from "human-stringify";
import { AnyFunction } from "../cloudify";
import { FunctionCall, FunctionReturn } from "../shared";
import * as aws from "aws-sdk";

let sqs = new aws.SQS({ apiVersion: "2012-11-05" });

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

export async function trampoline(
    event: any,
    _context: any,
    callback: (err: Error | null, obj: FunctionReturn) => void
) {
    console.log(`${humanStringify(event)}`);
    const { name, args, CallId } = event as FunctionCall;
    try {
        if (!name) {
            throw new Error("Invalid function call request");
        }

        const func = funcs[name];
        if (!func) {
            throw new Error(`Function named "${name}" not found`);
        }

        if (!args) {
            throw new Error("Invalid arguments to function call");
        }

        console.log(`func: ${name}, args: ${humanStringify(args)}`);

        const rv = await func.apply(undefined, args);

        callback(null, {
            type: "returned",
            value: rv,
            CallId
        });
    } catch (err) {
        const errObj = {};
        Object.getOwnPropertyNames(err).forEach(name => (errObj[name] = err[name]));
        console.log(`errObj: ${humanStringify(errObj)}`);
        callback(null, {
            type: "error",
            value: errObj,
            CallId
        });
    }
}

export async function queueTrampoline(
    event: any,
    context: any,
    callback: (err: Error | null, obj: object) => void
) {
    // XXX
    try {
        trampoline(event, context, (err, obj) => {
            sqs.sendMessage({ QueueUrl: ResponseQueueUrl, MessageBody: obj });
        });
    } catch (err) {}
}

console.log(`Successfully loaded cloudify trampoline function.`);
