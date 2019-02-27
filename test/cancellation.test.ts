import test, { ExecutionContext } from "ava";
import { CommonOptions, faast, Provider, providers } from "../index";
import {
    clearLeakDetector,
    detectAsyncLeaks,
    startAsyncTracing,
    stopAsyncTracing
} from "../src/trace";
import * as funcs from "./fixtures/functions";
import { configs, sleep, title } from "./fixtures/util";

async function testCancellation(
    t: ExecutionContext,
    provider: Provider,
    options?: CommonOptions
) {
    await sleep(0); // wait until ava sets its timeout so it doesn't get picked up by async_hooks.
    startAsyncTracing();
    const cloudFunc = await faast(provider, funcs, "./fixtures/functions", {
        ...options,
        childProcess: true,
        gc: false
    });
    try {
        cloudFunc.functions.spin(10000).catch(_ => {});
        await sleep(500); // wait until the request actually starts
    } finally {
        await cloudFunc.cleanup();
    }
    stopAsyncTracing();
    await sleep(500);
    const leaks = detectAsyncLeaks();
    t.true(leaks.length === 0);
    clearLeakDetector();
}

for (const provider of providers) {
    let configurations = configs;
    if (provider !== "local") {
        configurations = configs.filter(t => t.childProcess === true);
    }
    for (const config of configurations) {
        test.serial(
            title(provider, `cleanup waits for all child processes to exit`, config),
            testCancellation,
            provider,
            config
        );
    }
}
