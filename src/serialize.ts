import { deepStrictEqual } from "assert";
import { inspect } from "util";
import { FunctionCall, FunctionReturn } from "./wrapper";
import { FaastError } from "./error";

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

export const ESERIALIZE = "ESERIALIZE";

export function serializeCall({
    call,
    validate
}: {
    call: FunctionCall;
    validate: boolean;
}) {
    const callStr = JSON.stringify(call);
    if (validate) {
        const deserialized = JSON.parse(callStr);
        deepCopyUndefined(deserialized, call);
        try {
            deepStrictEqual(deserialized, call);
        } catch {
            const error = new FaastError(
                `faast: Detected '${
                    call.name
                }' is unsupported because one of its arguments cannot be serialized by JSON.stringify
  original arguments: ${inspect(call.args)}
serialized arguments: ${inspect(deserialized.args)}`
            );
            error.code = ESERIALIZE;
            throw error;
        }
    }
    return callStr;
}

export function serializeReturn({
    returned,
    validate
}: {
    returned: FunctionReturn;
    validate: boolean;
}) {
    const rv = JSON.stringify(returned);
    if (validate) {
        const deserialized = JSON.parse(rv);
        deepCopyUndefined(deserialized.value, returned.value);
        try {
            deepStrictEqual(deserialized.value, returned.value);
        } catch {
            const error = new FaastError(
                `faast: Detected callId ${
                    returned.callId
                } returns an unsupported value that cannot be serialized by JSON.stringify
  original arguments: ${inspect(returned.value)}
serialized arguments: ${inspect(deserialized.value)}`
            );
            error.code = ESERIALIZE;
            throw error;
        }
    }
    return rv;
}
