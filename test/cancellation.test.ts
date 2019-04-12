import test, { ExecutionContext } from "ava";
import { CommonOptions, faast, Provider, providers } from "../index";
import {
    clearLeakDetector,
    detectAsyncLeaks,
    startAsyncTracing,
    stopAsyncTracing
} from "../src/trace";
import * as funcs from "./fixtures/functions";
import { configs, sleep, title, withClock } from "./fixtures/util";

function testCancellation(
    t: ExecutionContext,
    provider: Provider,
    options?: CommonOptions
) {
    return withClock(async () => {
        await sleep(0); // wait until ava sets its timeout so it doesn't get picked up by async_hooks.
        startAsyncTracing();
        const faastModule = await faast(provider, funcs, "./fixtures/functions", {
            ...options,
            childProcess: true,
            gc: false
        });
        try {
            faastModule.functions.spin(10000).catch(_ => {});
            await sleep(500); // wait until the request actually starts
        } finally {
            await faastModule.cleanup();
        }
        stopAsyncTracing();
        await sleep(500);
        const leaks = detectAsyncLeaks();
        t.true(leaks.length === 0);
        clearLeakDetector();
    });
}

for (const provider of providers) {
    let configurations = configs;
    if (provider !== "local") {
        configurations = configs.filter(t => t.childProcess === true);
    }
    for (const config of configurations) {
        // Cancellation tests must be run serially because the point is to
        // detect async operations started by faast.js that are not completed
        // before cleanup returns.
        test.serial(
            title(
                provider,
                `cleanup waits for all async operations to complete before returning`,
                config
            ),
            testCancellation,
            provider,
            config
        );
    }
}
