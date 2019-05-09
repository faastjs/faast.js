import { deepStrictEqual } from "assert";
import { inspect } from "util";
import { FunctionCall, FunctionReturn } from "./wrapper";
import { FaastError } from "./error";

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

export function serialize({ arg, validate }: { arg: any; validate: boolean }) {
    const str = JSON.stringify(arg);
    if (validate) {
        const deserialized = JSON.parse(str);
        deepCopyUndefined(deserialized, arg);
        deepStrictEqual(deserialized, arg);
    }
    return str;
}

export function deserialize(str: string) {
    return JSON.parse(str);
}

export function serializeCall({
    call,
    validate
}: {
    call: FunctionCall;
    validate: boolean;
}) {
    try {
        return serialize({ arg: call, validate });
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

export function deserializeCall(raw: string): FunctionCall {
    return deserialize(raw);
}

export function serializeReturn({
    returned,
    validate
}: {
    returned: FunctionReturn;
    validate: boolean;
}) {
    try {
        return serialize({ arg: returned, validate });
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

export function deserializeReturn(raw: string): FunctionReturn {
    return deserialize(raw);
}
