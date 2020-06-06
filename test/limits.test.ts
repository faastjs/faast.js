import test, { ExecutionContext } from "ava";
import { inspect } from "util";
import { CommonOptions, faast, Provider, FaastError, FaastErrorNames } from "../index";
import * as funcs from "./fixtures/functions";
import { title } from "./fixtures/util";

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
            t.is(
                FaastError.hasCauseWithName(err, FaastErrorNames.ETIMEOUT),
                true,
                `${inspect(err)}`
            );
        }
    } finally {
        await lambda.cleanup();
    }
}

/**
 * The purpose of this test is to verify that a CPU hogging async generator
 * function won't starve the sending logic, so yield messages prior to the CPU
 * intensive work are  delivered.
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

type LimitType = "memory" | "timeout" | "generator";

const configurations: [Provider, CommonOptions, LimitType[]][] = [
    ["aws", { mode: "https", childProcess: true }, ["memory", "timeout", "generator"]],
    ["aws", { mode: "queue", childProcess: true }, ["memory", "timeout", "generator"]],
    ["aws", { mode: "https", childProcess: false }, ["memory", "timeout", "generator"]],
    ["aws", { mode: "queue", childProcess: false }, ["memory", "timeout", "generator"]],
    ["google", { mode: "https", childProcess: true }, ["memory", "timeout"]],
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
    if (limitTypes.find(t => t === "generator")) {
        test(
            title(provider, `generator timeout`, config),
            testGenerator,
            provider,
            config
        );
    }
}
