import test, { ExecutionContext } from "ava";
import { inspect } from "util";
import { faastify, Provider } from "../src/faast";
import { CommonOptions } from "../src/provider";
import { configs, providers } from "./configurations";
import * as funcs from "./functions";

async function testTimeout(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
) {
    let lambda = await faastify(provider, funcs, "../test/functions", {
        ...options,
        timeout: 2,
        maxRetries: 0,
        gc: false
    });
    try {
        await t.throwsAsync(lambda.functions.spin(4 * 1000), /time/i);
    } finally {
        await lambda.cleanup();
    }
}

async function limitOk(t: ExecutionContext, provider: Provider, options: CommonOptions) {
    let lambda = await faastify(provider, funcs, "../test/functions", {
        ...options,
        timeout: 200,
        memorySize: 512,
        maxRetries: 0,
        gc: false
    });

    try {
        const bytes = 64 * 1024 * 1024;
        const rv = await lambda.functions.allocate(bytes);
        t.is(rv.elems, bytes / 8);
    } finally {
        await lambda.cleanup();
    }
}

async function limitFail(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
) {
    let lambda = await faastify(provider, funcs, "../test/functions", {
        ...options,
        timeout: 200,
        memorySize: 512,
        maxRetries: 0,
        gc: false
    });

    try {
        const bytes = 512 * 1024 * 1024;
        await t.throwsAsync(lambda.functions.allocate(bytes), /memory/i);
    } finally {
        lambda && (await lambda.cleanup());
    }
}

const configurations: [Provider, CommonOptions][] = [
    ["aws", { mode: "https" }],
    ["aws", { mode: "queue" }],
    ["local", { childProcess: true }],
    ["google", { mode: "https" }],
    ["google", { mode: "queue" }]
];

for (const [provider, config] of configurations) {
    const opts = inspect(config);
    let remote = "";
    if (provider !== "local") {
        remote = "remote";
    }
    test(`${remote} ${provider} memory under limit ${opts}`, limitOk, provider, config);
    if (provider === "google" && config.mode === "queue") {
        // Google in queue mode cannot detect OOM errors.
    } else {
        test(`${remote} ${provider} out of memory ${opts}`, limitFail, provider, config);
    }
    test(`${remote} ${provider} timeout ${opts}`, testTimeout, provider, config);
}
