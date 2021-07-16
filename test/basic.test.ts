import test, { ExecutionContext } from "ava";
import { CommonOptions, faast, FaastError, Provider, providers } from "../index";
import * as funcs from "./fixtures/functions";
import { configs, noValidateConfigs, title, toArray } from "./fixtures/util";

function nodeMajorVersion() {
    const match = process.version.match(/^v(\d+)\./);
    if (match) {
        return Number(match[1]);
    }
    return 0;
}

async function testBasic(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
) {
    const opts: CommonOptions = {
        timeout: 60,
        gc: "off",
        description: t.title,
        env: { faastEnvironmentVariable: "the_answer_is_42" },
        ...options
    };
    const faastModule = await faast(provider, funcs, opts);
    const remote = faastModule.functions;

    try {
        t.is(await remote.hello("Andy"), "Hello Andy!");
        t.is(await remote.identityString("你好"), "你好");
        t.is(await remote.identityNum(42), 42);
        t.is(await remote.identityNum(Infinity), Infinity);
        t.is(await remote.identityNum(-Infinity), -Infinity);
        if (nodeMajorVersion() >= 10) {
            t.is(await remote.identityNum(NaN), NaN);
        }
        t.is(await remote.empty(), undefined);
        t.is(await remote.arrow("arrow"), "arrow");
        t.is(await remote.asyncArrow("asyncArrow"), "asyncArrow");
        t.is(await remote.fact(5), 120);
        t.is(await remote.concat("abc", "def"), "abcdef");
        await t.throwsAsync(() => remote.error("hey"), {
            message: /Expected error. Arg: hey/
        });
        t.is(await remote.noargs(), "called function with no args.");
        t.is(await remote.async(), "async function: success");
        t.is(typeof (await remote.path()), "string");
        t.is(await remote.optionalArg(), "No arg");
        t.is(await remote.optionalArg("has arg"), "has arg");
        const date = new Date();
        t.deepEqual(await remote.identityDate(date), date);
        const buffer = Buffer.from("contents");
        t.deepEqual(await remote.identityBuffer(buffer), buffer);
        t.deepEqual(await remote.identityArrayNum([42, 8, 10]), [42, 8, 10]);
        const inf = [Infinity, -Infinity];
        t.deepEqual(await remote.identityArrayNum(inf), inf);
        if (nodeMajorVersion() >= 10) {
            t.deepEqual(await remote.identityArrayNum([NaN]), [NaN]);
        }
        t.deepEqual(await remote.identityArrayString(["a", "there"]), ["a", "there"]);
        t.is(await remote.identityBool(true), true);
        t.is(await remote.identityBool(false), false);
        t.is(await remote.identityUndefined(undefined), undefined);
        t.is(await remote.identityNull(null), null);
        t.deepEqual(await remote.identityObject({}), {});
        t.deepEqual(await remote.identityObject({ a: 42, b: "hello" }), {
            a: 42,
            b: "hello"
        });
        const int8 = Int8Array.of(0, -8, 42);
        t.deepEqual(await remote.identityInt8(int8), int8);
        const uint8 = Uint8Array.of(0, 8, 42);
        t.deepEqual(await remote.identityUint8(uint8), uint8);
        const uint8Clamped = Uint8ClampedArray.of(0, 8, 42);
        t.deepEqual(await remote.identityUint8Clamped(uint8Clamped), uint8Clamped);
        const int16 = Int16Array.of(0, 8, 42, -1);
        t.deepEqual(await remote.identityInt16(int16), int16);
        const uint16 = Uint16Array.of(0, 8, 42, -1);
        t.deepEqual(await remote.identityUint16(uint16), uint16);
        const int32 = Int32Array.of(0, 8, 42, -1);
        t.deepEqual(await remote.identityInt32(int32), int32);
        const uint32 = Uint32Array.of(0, 8, 42, -1);
        t.deepEqual(await remote.identityUint32(uint32), uint32);
        const float32 = Float32Array.of(0, 0.3, 100.042, -1);
        t.deepEqual(await remote.identityFloat32(float32), float32);
        const float64 = Float64Array.of(0, 0.3, 100.042, -1);
        t.deepEqual(await remote.identityFloat64(float64), float64);
        const m = new Map([
            [1, 2],
            [42, 10]
        ]);
        t.deepEqual(await remote.identityMap(m), m);
        const s = new Set([1, 42, 100]);
        t.deepEqual(await remote.identitySet(s), s);
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
            t.regex(err.message, /^intentionally rejected/);
        }
        try {
            await remote.customError();
            t.fail("remote.customError() did not reject as expected");
        } catch (err) {
            t.true(err instanceof FaastError);
            t.truthy(err.message.match(/^custom error message/));
            t.is(FaastError.info(err).custom, "custom value");
        }
        t.is(await remote.getEnv("faastEnvironmentVariable"), "the_answer_is_42");
        t.is(await remote.getEnv("faastNonexistent"), undefined);
        t.deepEqual(await remote.returnsError(), funcs.returnsError());
        const elements = ["bar", "baz"];
        t.deepEqual(await toArray(remote.generator(elements)), elements);
        t.deepEqual(await toArray(remote.asyncGenerator(elements)), elements);
    } finally {
        console.log(`error logs: ${faastModule.logUrl()}`);
        await faastModule.cleanup();
    }
}

async function testBasicRequire(t: ExecutionContext, provider: Provider) {
    const requiredFuncs = require("./fixtures/functions");
    const opts: CommonOptions = { timeout: 30, gc: "off", description: t.title };
    const faastModule = await faast(provider, requiredFuncs, opts);
    const remote = faastModule.functions;
    try {
        t.is(await remote.identityString("id"), "id");
        t.is(await remote.arrow("arrow"), "arrow");
    } finally {
        await faastModule.cleanup();
    }
}

// async function testCpuMetrics(t: ExecutionContext, provider: Provider) {
//     t.plan(4);

//     const lambda = await faast(provider, funcs,  {
//         childProcess: true,
//         timeout: 90,
//         memorySize: 512,
//         maxRetries: 0,
//         gc: "off",
//         description: t.title
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
    for (const config of [...configs, ...noValidateConfigs]) {
        test(title(provider, `basic calls`, config), testBasic, provider, config);
    }
    // XXX Disable CPU metrics for now.
    // test(title(provider, `cpu metrics are received`), testCpuMetrics, provider);
    test(title(provider, `basic calls with require`), testBasicRequire, provider);
}
