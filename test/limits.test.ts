import test, { ExecutionContext } from "ava";
import { inspect } from "util";
import { CommonOptions, faast, Provider, FaastError, FaastErrorNames } from "../index";
import * as funcs from "./fixtures/functions";
import { title } from "./fixtures/util";
import { config } from "aws-sdk";

/**
 * Note that there is an AWS Lambda bug where timeouts are not delivered if the
 * function has a timeout >= 300s, and the function is invoked directly with the
 * Invoke API (e.g. in faast.js' "https" mode, which is the default.). In this
 * case if faast.js has childProcess mode on (the default), then it will set its
 * own timeout. This situation is not explicitly tested here because it would
 * make the entire testsuite slower for just one test. To test this situation
 * manually, change the timeout to 300 or more, and run one of these tests:
 *
 *    $ ava --timeout=10m -m="remote aws generator timeout { mode: 'https', childProcess: true }"
 *    $ ava --timeout=10m -m="remote aws timeout { mode: 'https', childProcess: true }"
 */
async function testTimeout(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
) {
    const lambda = await faast(provider, funcs, {
        ...options,
        timeout: 5,
        maxRetries: 0,
        gc: "off",
        description: t.title
    });
    t.plan(1);
    // t.log(`${lambda.logUrl()}`);
    try {
        try {
            await lambda.functions.infiniteLoop();
        } catch (err) {
            const isTimeout = FaastError.hasCauseWithName(err, FaastErrorNames.ETIMEOUT);
            t.is(isTimeout, true, `${inspect(err)}`);
        }
    } finally {
        await lambda.cleanup();
    }
}

/**
 * The purpose of this test is to verify that a CPU hogging async generator
 * function won't starve the sending logic, so yield messages prior to the CPU
 * intensive work are delivered.
 */
async function testGenerator(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
) {
    t.plan(2);
    const lambda = await faast(provider, funcs, {
        ...options,
        timeout: 5,
        maxRetries: 0,
        gc: "off",
        description: t.title
    });
    // t.log(`${lambda.logUrl()}`);
    try {
        const arg = "hello, generator!";
        for await (const result of lambda.functions.generateThenInfiniteLoop(arg)) {
            t.is(result, arg);
        }
        t.fail("Did not timeout");
    } catch (err) {
        t.is(FaastError.hasCauseWithName(err, FaastErrorNames.ETIMEOUT), true);
    } finally {
        await lambda.cleanup();
    }
}

async function memoryLimitOk(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
) {
    const lambda = await faast(provider, funcs, {
        ...options,
        timeout: 200,
        memorySize: 512,
        maxRetries: 0,
        gc: "off",
        description: t.title
    });

    try {
        const bytes = 64 * 1024 * 1024;
        const rv = await lambda.functions.allocate(bytes);
        t.is(rv.elems, bytes / 8);
    } finally {
        await lambda.cleanup();
    }
}

async function memoryLimitFail(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
) {
    const lambda = await faast(provider, funcs, {
        ...options,
        timeout: 200,
        memorySize: 512,
        maxRetries: 0,
        gc: "off",
        description: t.title
    });

    try {
        const bytes = 512 * 1024 * 1024;
        await t.throwsAsync(lambda.functions.allocate(bytes), { message: /memory/i });
    } finally {
        lambda && (await lambda.cleanup());
    }
}

// Note that this test takes 180s by default. Set the ava timeout to 2m or
// longer otherwise it will fail with a timeout error.
async function testLongInvoke(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
) {
    // The http timeout is 120s in awssdk by default. Uncomment the following
    // line to shorten it to 20s for focused testing. Note that shortening it
    // below 20s causes (harmless) timeout error messages from SQS on the long
    // polling response queue. If faast.js is working correctly, the shortened
    // timeout should not cause a test failure.
    //
    // config.update({ httpOptions: { timeout: 20000 } });
    const opts: CommonOptions = {
        timeout: 500,
        gc: "off",
        description: t.title,
        ...options
    };
    const faastModule = await faast(provider, funcs, opts);
    const remote = faastModule.functions;
    try {
        let i = 0;
        const args = ["a", "b", "c"];
        // The use of an async generator is to mimick a real use case from a
        // client of faast.js. The presence of an error should also be revealed
        // with a regular remote function call.
        for await (const arg of remote.asyncGeneratorDelay(args, 60000)) {
            t.is(arg, args[i++]);
        }
    } finally {
        await faastModule.cleanup();
    }
}

type LimitType = "memory" | "timeout" | "generator" | "long";
const allLimits = ["memory", "timeout", "long", "generator"] as const;

const configurations: [Provider, CommonOptions, readonly LimitType[]][] = [
    ["aws", { mode: "https", childProcess: true }, allLimits],
    ["aws", { mode: "queue", childProcess: true }, allLimits],
    ["aws", { mode: "https", childProcess: false }, ["memory", "timeout", "generator"]],
    ["aws", { mode: "queue", childProcess: false }, ["memory", "timeout", "generator"]],
    ["google", { mode: "https", childProcess: true }, ["memory", "timeout", "long"]],
    ["google", { mode: "queue", childProcess: true }, []],
    ["local", {}, ["timeout"]]
];

for (const [provider, config, limitTypes] of configurations) {
    const opts = inspect(config);
    if (limitTypes.find(t => t === "memory")) {
        test(
            title(provider, `memory under limit ${opts}`),
            memoryLimitOk,
            provider,
            config
        );
        test(title(provider, `out of memory`, config), memoryLimitFail, provider, config);
    }
    if (limitTypes.find(t => t === "timeout")) {
        test(title(provider, `timeout`, config), testTimeout, provider, config);
    }
    if (limitTypes.find(t => t === "long")) {
        test(title(provider, `long invoke`, config), testLongInvoke, provider, config);
    }
    if (limitTypes.find(t => t === "generator")) {
        test(
            title(provider, `generator timeout`, config),
            testGenerator,
            provider,
            config
        );
    }
}
