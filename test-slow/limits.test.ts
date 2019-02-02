import test, { Macro } from "ava";
import { inspect } from "util";
import * as faast from "../src/faast";
import { faastify, Provider } from "../src/faast";
import { warn } from "../src/log";
import { CommonOptions } from "../src/provider";
import * as funcs from "../test/functions";

const testTimeout: Macro<[Provider, CommonOptions]> = async (t, provider, options) => {
    let lambda: faast.CloudFunction<typeof funcs>;
    lambda = await faastify(provider, funcs, "./functions", {
        ...options,
        timeout: 2,
        maxRetries: 0,
        gc: false
    });
    test.after.always(() => lambda && lambda.cleanup());
    await t.throwsAsync(lambda.functions.sleep(4 * 1000), /time/i);
};

const testMemoryLimitOk: Macro<[Provider, CommonOptions]> = async (
    t,
    provider,
    options
) => {
    let lambda: faast.CloudFunction<typeof funcs>;
    lambda = await faastify(provider, funcs, "./functions", {
        ...options,
        timeout: 200,
        memorySize: 512,
        maxRetries: 0,
        gc: false
    });

    test.after.always(() => lambda && lambda.cleanup());

    const bytes = 64 * 1024 * 1024;
    const rv = await lambda.functions.allocate(bytes);
    t.is(rv.elems, bytes / 8);
};

const testMemoryLimitFail: Macro<[Provider, CommonOptions]> = async (
    t,
    provider,
    options
) => {
    let lambda: faast.CloudFunction<typeof funcs>;

    lambda = await faastify(provider, funcs, "./functions", {
        ...options,
        timeout: 200,
        memorySize: 512,
        maxRetries: 0,
        gc: false
    });

    test.after.always(() => lambda && lambda.cleanup());

    const bytes = 512 * 1024 * 1024;
    await t.throwsAsync(lambda.functions.allocate(bytes), /memory/i);
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
    test(`${provider} memory under limit ${opts}`, testMemoryLimitOk, provider, config);
    test(`${provider} out of memory ${opts}`, testMemoryLimitFail, provider, config);
    test(`${provider} timeout ${opts}`, testTimeout, provider, config);
}
