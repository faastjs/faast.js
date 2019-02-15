import test, { ExecutionContext } from "ava";
import { inspect } from "util";
import * as faast from "../src/faast";
import { faastify } from "../src/faast";
import { CommonOptions } from "../src/provider";
import { sleep } from "../src/shared";
import {
    clearLeakDetector,
    detectAsyncLeaks,
    startAsyncTracing,
    stopAsyncTracing
} from "../src/trace";
import { providers, configs } from "./configurations";
import * as funcs from "./functions";

async function testCancellation(
    t: ExecutionContext,
    provider: faast.Provider,
    options?: CommonOptions
) {
    await sleep(0); // wait until ava sets its timeout so it doesn't get picked up by async_hooks.
    startAsyncTracing();
    const cloudFunc = await faastify(provider, funcs, "./functions", {
        ...options,
        childProcess: true,
        gc: false
    });
    cloudFunc.functions.spin(10000).catch(_ => {});
    await sleep(500); // wait until the request actually starts
    await cloudFunc.cleanup();
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
        let remote = provider === "local" ? "" : "remote";
        const opts = inspect(config, { breakLength: Infinity });
        test(
            `${remote} ${provider} ${opts} cleanup waits for all child processes to exit`,
            testCancellation,
            provider,
            config
        );
    }
}
