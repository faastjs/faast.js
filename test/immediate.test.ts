import { readFile as readFileCallback } from "fs";
import { URL } from "url";
import { promisify } from "util";
import { cloudify, immediate } from "../src/cloudify";
import { sleep } from "../src/shared";
import * as funcs from "./functions";
import { checkFunctions } from "./tests";
import { measureConcurrency } from "./util";

const readFile = promisify(readFileCallback);

async function testCleanup(options: immediate.Options) {
    const { remote, cloudFunc } = await cloudify(
        "immediate",
        funcs,
        "./functions",
        options
    );
    let done = 0;

    remote
        .hello("there")
        .then(_ => done++)
        .catch(_ => {});

    remote
        .delay(1000)
        .then(_ => done++)
        .catch(_ => {});

    await cloudFunc.cleanup();
    expect(done).toBe(0);
}

async function testOrder(options: immediate.Options) {
    const { remote, cloudFunc } = await cloudify(
        "immediate",
        funcs,
        "./functions",
        options
    );
    expect.assertions(2);

    const a = remote.emptyReject();
    const b = remote.delay(0);
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
    options: immediate.Options;
    maxConcurrency: number;
    expectedConcurrency: number;
}) {
    const { remote, cloudFunc } = await cloudify(
        "immediate",
        funcs,
        "./functions",
        options
    );

    try {
        const N = maxConcurrency;
        const promises = [];
        for (let i = 0; i < N; i++) {
            promises.push(remote.spin(500));
        }

        const timings = await Promise.all(promises);
        expect(measureConcurrency(timings)).toBe(expectedConcurrency);
    } finally {
        await cloudFunc.cleanup();
    }
}

describe("cloudify immediate mode", () => {
    describe("basic functions", () => checkFunctions("immediate", {}));

    describe("basic functions with child process", () =>
        checkFunctions("immediate", { childProcess: true }));

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

    async function readFirstLogfile(logDirectoryUrl: string) {
        const logFileUrl = new URL(logDirectoryUrl + "/0.log");
        const buf = await readFile(logFileUrl);
        return buf.toString().split("\n");
    }

    test("console.log and console.warn with child process", async () => {
        const { remote, cloudFunc } = await cloudify("immediate", funcs, "./functions", {
            childProcess: true,
            concurrency: 1
        });
        try {
            await remote.consoleLog("Remote console.log output");
            await remote.consoleWarn("Remote console.warn output");
            await remote.consoleError("Remote console.error output");

            await cloudFunc.stop();
            const messages = await readFirstLogfile(cloudFunc.logUrl());

            expect(messages).toContain("Remote console.log output");
            expect(messages).toContain("Remote console.warn output");
            expect(messages).toContain("Remote console.error output");
        } finally {
            await cloudFunc.cleanup();
        }
    });

    test("log files should be appended, not truncated, after child process crash", async () => {
        const { remote, cloudFunc } = await cloudify("immediate", funcs, "./functions", {
            childProcess: true,
            concurrency: 1,
            maxRetries: 1
        });
        try {
            await remote.consoleLog("output 1");
            try {
                await remote.processExit();
            } catch (err) {}
            await remote.consoleWarn("output 2");

            const messages = await readFirstLogfile(cloudFunc.logUrl());

            expect(messages).toContain("output 1");
            expect(messages).toContain("output 2");
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
        const { remote, cloudFunc } = await cloudify("immediate", funcs, "./functions", {
            childProcess: true
        });
        remote.spin(5000).catch(_ => {});
        while (true) {
            await sleep(100);
            if (cloudFunc.state.moduleWrappers.length > 0) {
                break;
            }
        }
        expect(cloudFunc.state.moduleWrappers.length).toBe(1);
        await cloudFunc.cleanup();
        expect(cloudFunc.state.moduleWrappers.length).toBe(0);
    });
});
