import test, { ExecutionContext } from "ava";
import { inspect } from "util";
import { CommonOptions, faast, Provider } from "../index";
import * as funcs from "./fixtures/functions";
import { title } from "./fixtures/util";

async function testTimeout(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
) {
    let wrapperVerbose = false;
    if (t.title.match(/.*google.*queue.*/)) {
        wrapperVerbose = true;
    }
    const lambda = await faast(provider, funcs, {
        ...options,
        timeout: 10,
        maxRetries: 0,
        gc: "off",
        debugOptions: { wrapperVerbose }
    });
    t.log(`${lambda.logUrl()}`);
    try {
        await t.throwsAsync(lambda.functions.spin(30 * 1000), /time/i);
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
        gc: "off"
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
        gc: "off"
    });

    try {
        const bytes = 512 * 1024 * 1024;
        await t.throwsAsync(lambda.functions.allocate(bytes), /memory/i);
    } finally {
        lambda && (await lambda.cleanup());
    }
}

// Memory limit setting isn't reliable on local mode.
const configurations: [Provider, CommonOptions][] = [
    ["aws", { mode: "https", childProcess: true }],
    ["aws", { mode: "queue", childProcess: true }],
    ["aws", { mode: "https", childProcess: false }],
    ["aws", { mode: "queue", childProcess: false }],
    ["google", { mode: "https" }],
    ["google", { mode: "queue" }]
];

for (const [provider, config] of configurations) {
    const opts = inspect(config);
    test(title(provider, `memory under limit ${opts}`), memoryLimitOk, provider, config);
    if (provider === "google" && config.mode === "queue") {
        // Google in queue mode cannot detect OOM errors.
    } else {
        test(title(provider, `out of memory`, config), memoryLimitFail, provider, config);
    }
    test(title(provider, `timeout`, config), testTimeout, provider, config);
}
