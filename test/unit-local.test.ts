import { URL } from "url";
import { faastify, local } from "../src/faast";
import { sleep } from "../src/shared";
import * as funcs from "./functions";
import {
    testFunctions,
    testMemoryLimit,
    testTimeout,
    testCpuMetrics,
    testCancellation
} from "./tests";
import { readFile } from "../src/fs";
import { measureConcurrency } from "./util";

async function testCleanup(options: local.Options) {
    const cloudFunc = await faastify("local", funcs, "./functions", options);
    const { hello, sleep } = cloudFunc.functions;
    let done = 0;

    hello("there")
        .then(_ => done++)
        .catch(_ => {});

    sleep(1000)
        .then(_ => done++)
        .catch(_ => {});

    await cloudFunc.cleanup();
    expect(done).toBe(0);
}

async function testOrder(options: local.Options) {
    const cloudFunc = await faastify("local", funcs, "./functions", options);
    expect.assertions(2);

    const a = cloudFunc.functions.emptyReject();
    const b = cloudFunc.functions.sleep(0);
    expect(await b).toBeUndefined();
    try {
        await a;
    } catch (err) {
        expect(err).toBeUndefined();
    } finally {
        await cloudFunc.cleanup();
    }
}

async function testConcurrency({
    options,
    maxConcurrency,
    expectedConcurrency
}: {
    options: local.Options;
    maxConcurrency: number;
    expectedConcurrency: number;
}) {
    const cloudFunc = await faastify("local", funcs, "./functions", options);

    try {
        const N = maxConcurrency;
        const promises = [];
        for (let i = 0; i < N; i++) {
            promises.push(cloudFunc.functions.spin(500));
        }

        const timings = await Promise.all(promises);
        expect(measureConcurrency(timings)).toBe(expectedConcurrency);
    } finally {
        await cloudFunc.cleanup();
    }
}

describe("faast.js local mode", () => {
    describe("basic functions", () => testFunctions("local", {}));

    describe("basic functions with child process", () =>
        testFunctions("local", { childProcess: true }));

    test("cleanup stops executions", () => testCleanup({}));

    test("cleanup stops executions with child process", () =>
        testCleanup({ childProcess: true }));

    test("out of order await (asynchronous catch) with no concurrency", () =>
        testOrder({ childProcess: false, concurrency: 1, maxRetries: 0 }));

    test("out of order await (asynchronous catch) with child process and no concurrency", () =>
        testOrder({ childProcess: true, concurrency: 1, maxRetries: 0 }));

    test("out of order await (asynchronous catch) with concurrency", () =>
        testOrder({ childProcess: false, concurrency: 2, maxRetries: 0 }));

    test("out of order await (asynchronous catch) with child process and concurrency", () =>
        testOrder({ childProcess: true, concurrency: 2, maxRetries: 0 }));

    test("out of order await (asynchronous catch) with concurrency and retries", () =>
        testOrder({ childProcess: false, concurrency: 2, maxRetries: 2 }));

    test("out of order await (asynchronous catch) with child process and concurrency and retries", () =>
        testOrder({ childProcess: true, concurrency: 2, maxRetries: 2 }));

    describe("process memory limit test", () =>
        testMemoryLimit("local", { childProcess: true }));

    describe("process timeout test", () => testTimeout("local", { childProcess: true }));

    describe("cpu metrics test", () => testCpuMetrics("local"));

    async function readFirstLogfile(logDirectoryUrl: string) {
        const logFileUrl = new URL(logDirectoryUrl + "/0.log");
        const buf = await readFile(logFileUrl);
        return buf
            .toString()
            .split("\n")
            .map(m => m.replace(/^\[(\d+)\]/, "[$pid]"));
    }

    test("console.log and console.warn with child process", async () => {
        const cloudFunc = await faastify("local", funcs, "./functions", {
            childProcess: true,
            concurrency: 1
        });
        try {
            await cloudFunc.functions.consoleLog("Remote console.log output");
            await cloudFunc.functions.consoleWarn("Remote console.warn output");
            await cloudFunc.functions.consoleError("Remote console.error output");

            await cloudFunc.cleanup({ deleteResources: false });
            const messages = await readFirstLogfile(cloudFunc.logUrl());
            expect(messages).toContain("[$pid]: Remote console.log output");
            expect(messages).toContain("[$pid]: Remote console.warn output");
            expect(messages).toContain("[$pid]: Remote console.error output");
        } finally {
            await cloudFunc.cleanup();
        }
    });

    test("log files should be appended, not truncated, after child process crash", async () => {
        const cloudFunc = await faastify("local", funcs, "./functions", {
            childProcess: true,
            concurrency: 1,
            maxRetries: 1
        });
        try {
            await cloudFunc.functions.consoleLog("output 1");
            try {
                await cloudFunc.functions.processExit();
            } catch (err) {}
            await cloudFunc.functions.consoleWarn("output 2");

            const messages = await readFirstLogfile(cloudFunc.logUrl());

            expect(messages).toContain("[$pid]: output 1");
            expect(messages).toContain("[$pid]: output 2");
        } finally {
            await cloudFunc.cleanup();
        }
    });

    test("concurrent executions with child processes", async () => {
        await testConcurrency({
            options: {
                childProcess: true
            },
            maxConcurrency: 5,
            expectedConcurrency: 5
        });
    });

    test("no concurrency for cpu bound work without child processes", async () => {
        await testConcurrency({
            options: {
                childProcess: false
            },
            maxConcurrency: 5,
            expectedConcurrency: 1
        });
    });

    test("cleanup waits for all child processes to exit", async () => {
        const cloudFunc = await faastify("local", funcs, "./functions", {
            childProcess: true
        });
        cloudFunc.functions.spin(5000).catch(_ => {});
        while (true) {
            await sleep(100);
            if (cloudFunc.state.wrappers.length > 0) {
                break;
            }
        }
        expect(cloudFunc.state.wrappers.length).toBe(1);
        await cloudFunc.cleanup();
        expect(cloudFunc.state.wrappers.length).toBe(0);
    });

    describe("cancellation", () => {
        testCancellation("local");
    });
});
