import { deepStrictEqual } from "assert";
import {
    FunctionCall,
    FunctionReturn,
    FunctionReturnSerialized,
    FunctionCallSerialized
} from "./wrapper";
import { FaastError } from "./error";
import { inspect } from "util";

export const ESERIALIZE = "ESERIALIZE";

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

const FJS_TYPE = "[faastjs type]";

function replacer(this: any, key: any, value: any) {
    const orig = this[key];
    if (typeof orig === "object") {
        if (orig instanceof Date) {
            return { [FJS_TYPE]: "Date", value };
        }
        if (orig instanceof Buffer) {
            return { [FJS_TYPE]: "Buffer", value };
        }
    } else if (typeof orig === "undefined") {
        return { [FJS_TYPE]: "undefined" };
    }
    return value;
}

export function _serialize(arg: any, validate: boolean) {
    const str = JSON.stringify(arg, replacer);
    if (validate) {
        const deserialized = _deserialize(str);
        deepCopyUndefined(deserialized, arg);
        deepStrictEqual(deserialized, arg);
    }
    return str;
}

function reviver(this: any, _: any, value: any) {
    try {
        if (typeof value === "object") {
            if (value.hasOwnProperty(FJS_TYPE)) {
                const type = value[FJS_TYPE];
                switch (type) {
                    case "Date":
                        return new Date(value["value"]);
                    case "Buffer":
                        return Buffer.from(value["value"]);
                    case "undefined":
                        return undefined;
                }
            }
        }
    } catch {}
    return value;
}

export function _deserialize(str: string) {
    return JSON.parse(str, reviver);
}

function deserializeArgs(s: string): any[] {
    const args = _deserialize(s);
    if (!Array.isArray(args)) {
        throw new FaastError(`deserialized arguments not an array: ${inspect(args)}`);
    }
    return args;
}

export function serializeFunctionCall(
    call: FunctionCall,
    validate: boolean
): FunctionCallSerialized {
    const { args, ...rest } = call;
    try {
        return { ...rest, serializedArgs: _serialize(call.args, validate) };
    } catch (err) {
        const error = new FaastError(
            err,
            `faast: Detected '${
                call.name
            }' is unsupported because one of its arguments cannot be serialized by JSON.stringify`
        );
        error.code = ESERIALIZE;
        throw error;
    }
}

export function deserializeFunctionCall(sCall: FunctionCallSerialized): FunctionCall {
    const { serializedArgs, ...rest } = sCall;
    return { ...rest, args: deserializeArgs(sCall.serializedArgs) };
}

export function serializeFunctionReturn(
    returned: FunctionReturn,
    validate: boolean
): FunctionReturnSerialized {
    const { value, ...rest } = returned;
    try {
        return { ...rest, serializedValue: _serialize(returned.value, validate) };
    } catch (err) {
        const error = new FaastError(
            err,
            `faast: Detected callId ${
                returned.callId
            } returns an unsupported value that cannot be serialized by JSON.stringify`
        );
        error.code = ESERIALIZE;
        throw error;
    }
}

export function deserializeFunctionReturn(
    returned: FunctionReturnSerialized
): FunctionReturn {
    const { serializedValue, ...rest } = returned;
    return { ...rest, value: _deserialize(serializedValue) };
}

export function serializeMessage(msg: any): string {
    return _serialize(msg, false);
}

export function deserializeMessage(msg: string): any {
    return _deserialize(msg);
}
