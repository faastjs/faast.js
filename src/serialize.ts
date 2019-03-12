import { deepStrictEqual } from "assert";
import { inspect } from "util";
import { FunctionCall, FunctionReturn } from "./wrapper";

export class FaastSerializationError extends Error {
    constructor(message: string) {
        super(message);
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
        throw new FaastSerializationError(
            `faast: Detected '${
                call.name
            }' is unsupported because one of its arguments cannot be serialized by JSON.stringify
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
        throw new FaastSerializationError(
            `faast: Detected callId ${
                returned.callId
            } returns an unsupported value that cannot be serialized by JSON.stringify
  original arguments: ${inspect(returned.value)}
serialized arguments: ${inspect(deserialized.value)}`
        );
    }
    return rv;
}
