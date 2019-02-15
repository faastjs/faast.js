import test, { Macro } from "ava";
import { inspect } from "util";
import * as faast from "../src/faast";
import { faastify, Provider } from "../src/faast";
import { CommonOptions } from "../src/provider";
import * as funcs from "../test/functions";

const testTimeout: Macro<[Provider, CommonOptions]> = async (t, provider, options) => {
    let lambda: faast.CloudFunction<typeof funcs> | undefined;
    try {
        lambda = await faastify(provider, funcs, "../test/functions", {
            ...options,
            timeout: 2,
            maxRetries: 0,
            gc: false
        });
        await t.throwsAsync(lambda.functions.sleep(4 * 1000), /time/i);
    } finally {
        lambda && (await lambda.cleanup());
    }
};

const limitOk: Macro<[Provider, CommonOptions]> = async (t, provider, options) => {
    let lambda: faast.CloudFunction<typeof funcs> | undefined;
    try {
        lambda = await faastify(provider, funcs, "../test/functions", {
            ...options,
            timeout: 200,
            memorySize: 512,
            maxRetries: 0,
            gc: false
        });

        const bytes = 64 * 1024 * 1024;
        const rv = await lambda.functions.allocate(bytes);
        t.is(rv.elems, bytes / 8);
    } finally {
        lambda && (await lambda.cleanup());
    }
};

const limitFail: Macro<[Provider, CommonOptions]> = async (t, provider, options) => {
    let lambda: faast.CloudFunction<typeof funcs> | undefined;
    try {
        lambda = await faastify(provider, funcs, "../test/functions", {
            ...options,
            timeout: 200,
            memorySize: 512,
            maxRetries: 0,
            gc: false
        });

        const bytes = 512 * 1024 * 1024;
        await t.throwsAsync(lambda.functions.allocate(bytes), /memory/i);
    } finally {
        lambda && (await lambda.cleanup());
    }
};

const configurations: [Provider, faast.aws.Options][] = [
    ["aws", { mode: "https" }],
    ["aws", { mode: "queue" }],
    ["local", { childProcess: true }],
    ["google", { mode: "https" }]
    // Queue mode on google doesn't report OOM or timeouts because there are no dead letter queues...
];

for (const [provider, config] of configurations) {
    const opts = inspect(config);
    let remote = "";
    if (provider !== "local") {
        remote = "remote";
    }
    test(`${remote} ${provider} memory under limit ${opts}`, limitOk, provider, config);
    test(`${remote} ${provider} out of memory ${opts}`, limitFail, provider, config);
    test(`${remote} ${provider} timeout ${opts}`, testTimeout, provider, config);
}
