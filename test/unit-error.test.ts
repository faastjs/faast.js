import test from "ava";
import { FaastError } from "../index";
import { synthesizeFaastError } from "../src/error";

test("FaastError basic error", t => {
    const error = new FaastError("bad error");
    const {
        name,
        stack,
        fullStack,
        info,
        logUrl,
        message,
        code,
        functionName,
        args,
        ...rest
    } = error;
    const _exhaustiveCheck: Required<typeof rest> = {};
    t.is(name, "FaastError");
    t.regex(stack!, /unit-error.test/);
    t.is(fullStack, stack);
    t.deepEqual(info, {});
    t.is(logUrl, undefined);
    t.is(message, "bad error");
    t.is(code, undefined);
    t.is(functionName, undefined);
    t.is(args, undefined);
    t.is(error.cause(), undefined);
});

function foo() {
    throw new Error("underlying error");
}

test("FaastError nested error", t => {
    let nested;
    try {
        foo();
    } catch (err) {
        nested = err;
    }
    const error = new FaastError(nested, "bad error");
    const {
        name,
        stack,
        fullStack,
        info,
        logUrl,
        message,
        code,
        functionName,
        args,
        ...rest
    } = error;
    const _exhaustiveCheck: Required<typeof rest> = {};
    t.is(name, "FaastError");
    t.regex(stack!, /unit-error.test/);
    t.regex(fullStack, /at foo /);
    t.deepEqual(info, {});
    t.is(logUrl, undefined);
    t.is(message, "bad error: underlying error");
    t.is(code, undefined);
    t.is(functionName, undefined);
    t.is(args, undefined);
    t.is(error.cause(), nested);
});

test("FaastError synthesized error", t => {
    const errObj = {
        message: "remote message",
        stack: "remote stack trace",
        name: "RemoteErrorName",
        custom: "remote custom property"
    };
    const logUrlString = "https://cloud.com/logs";
    const error = synthesizeFaastError(errObj, logUrlString, "functionName", ["arg"]);
    const {
        name,
        stack,
        fullStack,
        info,
        logUrl,
        message,
        code,
        functionName,
        args,
        ...rest
    } = error;
    const _exhaustiveCheck: Required<typeof rest> = {};

    t.is(name, "FaastError");
    t.true(stack!.indexOf(errObj.stack) >= 0);
    t.true(fullStack.indexOf(errObj.stack) >= 0);
    t.deepEqual(info, errObj);
    t.true(logUrl!.trim() === logUrlString);
    t.true(message.indexOf(errObj.message) >= 0);
    const cause = error.cause()! as FaastError;
    t.is(cause.message, logUrlString);
    t.is(code, undefined);
    t.is(functionName, "functionName");
    t.deepEqual(args, ["arg"]);
    t.true(cause.stack!.indexOf("faast.js cloud function invocation") >= 0);
    t.is(cause.fullStack, cause.stack);
    t.true(cause.fullStack.indexOf(logUrlString) >= 0);
});
