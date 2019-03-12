import test, { ExecutionContext } from "ava";
import { CommonOptions, faast, Provider, providers, FaastError } from "../index";
import * as funcs from "./fixtures/functions";
import { configs, title } from "./fixtures/util";

async function testBasic(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
) {
    const opts = { timeout: 30, gc: false, ...options };
    const cloudFunc = await faast(provider, funcs, "./fixtures/functions", opts);
    const remote = cloudFunc.functions;

    try {
        t.is(await remote.hello("Andy"), "Hello Andy!");
        t.is(await remote.identity("你好"), "你好");
        t.is(await remote.identityNum(42), 42);
        t.is(await remote.arrow("arrow"), "arrow");
        t.is(await remote.asyncArrow("asyncArrow"), "asyncArrow");
        t.is(await remote.fact(5), 120);
        t.is(await remote.concat("abc", "def"), "abcdef");
        await t.throwsAsync(() => remote.error("hey"), /Expected error. Arg: hey/);
        t.is(await remote.noargs(), "called function with no args.");
        t.is(await remote.async(), "async function: success");
        t.is(typeof (await remote.path()), "string");
        t.is(await remote.optionalArg(), "No arg");
        t.is(await remote.optionalArg("has arg"), "has arg");
        try {
            await remote.emptyReject();
            t.fail("remote.emptyReject() did not reject as expected");
        } catch (err) {
            t.is(err, undefined);
        }
        try {
            await remote.rejected();
            t.fail("remote.rejected() did not reject as expected");
        } catch (err) {
            t.is(err, "intentionally rejected");
        }
        try {
            await remote.customError();
            t.fail("remote.customError() did not reject as expected");
        } catch (err) {
            t.true(err instanceof FaastError);
            const ferr = err as FaastError;
            t.truthy(ferr.message.match(/^message/));
            t.is(ferr.custom, "custom");
        }
    } finally {
        await cloudFunc.cleanup();
    }
}

async function testBasicRequire(t: ExecutionContext, provider: Provider) {
    const requiredFuncs = require("./fixtures/functions");
    const opts = { timeout: 30, gc: false };
    const cloudFunc = await faast(provider, requiredFuncs, "./fixtures/functions", opts);
    const remote = cloudFunc.functions;
    try {
        t.is(await remote.identity("id"), "id");
        t.is(await remote.arrow("arrow"), "arrow");
    } finally {
        await cloudFunc.cleanup();
    }
}

// async function testCpuMetrics(t: ExecutionContext, provider: Provider) {
//     t.plan(4);

//     const lambda = await faast(provider, funcs, "./fixtures/functions", {
//         childProcess: true,
//         timeout: 90,
//         memorySize: 512,
//         maxRetries: 0,
//         gc: false
//     });

//     try {
//         const NSec = 4;
//         await lambda.functions.spin(NSec * 1000);
//         const usage = lambda.cpuUsage.get("spin");
//         t.truthy(usage);
//         t.true(usage!.size > 0);
//         for (const [, instance] of usage!) {
//             t.true(instance.stime instanceof Statistics);
//             t.true(instance.utime instanceof Statistics);
//             break;
//         }
//     } finally {
//         await lambda.cleanup();
//     }
// }

for (const provider of providers) {
    for (const config of configs) {
        test(title(provider, `basic calls`, config), testBasic, provider, config);
    }
    // XXX Disable CPU metrics for now.
    // test(title(provider, `cpu metrics are received`), testCpuMetrics, provider);
    test(title(provider, `basic calls with require`), testBasicRequire, provider);
}
