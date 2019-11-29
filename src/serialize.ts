import { deepStrictEqual } from "assert";
import { inspect } from "util";
import { FaastError } from "./error";
import {
    FunctionCall,
    FunctionCallSerialized,
    FunctionReturn,
    FunctionReturnSerialized
} from "./wrapper";

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
    const type = Object.prototype.toString.call(orig).slice(8, -1);
    if (typeof orig === "object" && orig instanceof Buffer) {
        return { [FJS_TYPE]: "Buffer", value };
    }
    switch (type) {
        case "Undefined":
            return { [FJS_TYPE]: type };
        case "Number":
            if (orig === Number.POSITIVE_INFINITY) {
                return { [FJS_TYPE]: type, value: "+Infinity" };
            } else if (orig === Number.NEGATIVE_INFINITY) {
                return { [FJS_TYPE]: type, value: "-Infinity" };
            } else if (Number.isNaN(orig)) {
                return { [FJS_TYPE]: type, value: "NaN" };
            }
            return value;
        case "Error": {
            const errObj: any = {};
            Object.getOwnPropertyNames(value).forEach(name => {
                if (typeof (value as any)[name] === "string") {
                    errObj[name] = (value as any)[name];
                }
            });
            return { [FJS_TYPE]: type, value: errObj };
        }
        case "Date":
            return { [FJS_TYPE]: type, value };
        case "Int8Array":
        case "Uint8Array":
        case "Uint8ClampedArray":
        case "Int16Array":
        case "Uint16Array":
        case "Int32Array":
        case "Uint32Array":
        case "Float32Array":
        case "Float64Array":
        case "Map":
        case "Set":
            return { [FJS_TYPE]: type, value: [...orig] };
        default:
            return value;
    }
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
                    case "Error": {
                        const sErr = value["value"];
                        const err = new Error(sErr.message);
                        for (const key of Object.keys(sErr)) {
                            (err as any)[key] = sErr[key];
                        }
                        return err;
                    }
                    case "Int8Array":
                        return new Int8Array(value["value"]);
                    case "Uint8Array":
                        return new Uint8Array(value["value"]);
                    case "Uint8ClampedArray":
                        return new Uint8ClampedArray(value["value"]);
                    case "Int16Array":
                        return new Int16Array(value["value"]);
                    case "Uint16Array":
                        return new Uint16Array(value["value"]);
                    case "Int32Array":
                        return new Int32Array(value["value"]);
                    case "Uint32Array":
                        return new Uint32Array(value["value"]);
                    case "Float32Array":
                        return new Float32Array(value["value"]);
                    case "Float64Array":
                        return new Float64Array(value["value"]);
                    case "Undefined":
                        return undefined;
                    case "Number": {
                        switch (value["value"]) {
                            case "+Infinity":
                                return Number.POSITIVE_INFINITY;
                            case "-Infinity":
                                return Number.NEGATIVE_INFINITY;
                            case "NaN":
                                return Number.NaN;
                            default:
                                return value;
                        }
                    }
                    case "Map":
                        return new Map(value["value"]);
                    case "Set":
                        return new Set(value["value"]);
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
            `faast: Detected '${call.name}' argument cannot be serialized by JSON.stringify`
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
            `faast: Detected callId ${returned.callId} returns a value that cannot be serialized by JSON.stringify`
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
