import test from "ava";
import { FaastError } from "../index";
import { synthesizeFaastError, FaastErrorNames } from "../src/error";

test("FaastError basic error", t => {
    const error = new FaastError("bad error");
    const { name, stack, message, ...rest } = error;
    const _exhaustiveCheck: Required<typeof rest> = {};
    t.is(name, FaastErrorNames.EGENERIC);
    t.regex(stack!, /unit-error.test/);
    t.is(FaastError.fullStack(error), stack ?? "");
    t.deepEqual(FaastError.info(error), {});
    t.is(message, "bad error");
    t.is(error.cause(), undefined);
});

function foo() {
    throw new Error("underlying error");
}

test("FaastError nested error", t => {
    let nested;
    try {
        foo();
    } catch (err: any) {
        nested = err;
    }
    const error = new FaastError(nested, "bad error");
    const { name, stack, message, ...rest } = error;
    const _exhaustiveCheck: Required<typeof rest> = {};
    t.is(name, FaastErrorNames.EGENERIC);
    t.regex(stack!, /unit-error.test/);
    t.regex(FaastError.fullStack(error), /foo/);
    t.deepEqual(FaastError.info(error), {});
    t.is(message, "bad error: underlying error");
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
    const error = synthesizeFaastError({
        errObj,
        logUrl: logUrlString,
        functionName: "functionName",
        args: ["arg"]
    });
    const { name, stack, message, ...rest } = error;
    const _exhaustiveCheck: Required<typeof rest> = {};

    t.is(name, errObj.name);
    t.true(stack!.indexOf(errObj.stack) >= 0);
    t.true(FaastError.fullStack(error).indexOf(errObj.stack) >= 0);
    const info = FaastError.info(error);
    for (const key of Object.keys(errObj)) {
        t.is(info[key], (errObj as any)[key]);
    }
    t.true(FaastError.info(error).logUrl.trim() === logUrlString);
    t.true(message.indexOf(errObj.message) >= 0);
    const cause = error.cause()! as FaastError;
    t.is(cause.message, logUrlString);
    t.is(info.functionName, "functionName");
    t.deepEqual(info.args, ["arg"]);
    t.true(cause.stack!.indexOf("faast.js cloud function invocation") >= 0);
    t.is(FaastError.fullStack(cause), cause.stack ?? "");
    t.true(FaastError.fullStack(cause).indexOf(logUrlString) >= 0);
});

test("FaastError using option constructor", t => {
    const error = new FaastError({ name: FaastErrorNames.ETIMEOUT }, "message");
    const { name, stack, message, ...rest } = error;
    const _exhaustiveCheck: Required<typeof rest> = {};
    t.is(name, FaastErrorNames.ETIMEOUT);
});
