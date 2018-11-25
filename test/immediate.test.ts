import { cloudify, immediate } from "../src/cloudify";
import * as funcs from "./functions";
import { checkFunctions } from "./tests";
import { measureConcurrency } from "./util";
import { startAsyncTracing, traceAsyncLeaks, stopAsyncTracing } from "../src/tracing";

const ignore = () => {};

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
    }

    await cloudFunc.cleanup();
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

    const N = maxConcurrency;
    const promises = [];
    for (let i = 0; i < N; i++) {
        promises.push(remote.spin(500));
    }

    const timings = await Promise.all(promises);
    expect(measureConcurrency(timings)).toBe(expectedConcurrency);
    await cloudFunc.cleanup();
}

describe("cloudify immediate mode", () => {
    describe("basic functions", () => checkFunctions("immediate", { log: ignore }));

    describe("basic functions with child process", () =>
        checkFunctions("immediate", { childProcess: true, log: ignore }));

    test("cleanup stops executions", () => testCleanup({ log: ignore }));

    test("cleanup stops executions with child process", () =>
        testCleanup({ log: ignore, childProcess: true }));

    test("out of order await (asynchronous catch) with no concurrency", () =>
        testOrder({ childProcess: false, log: ignore, concurrency: 1, maxRetries: 0 }));

    test("out of order await (asynchronous catch) with child process and no concurrency", () =>
        testOrder({ childProcess: true, log: ignore, concurrency: 1, maxRetries: 0 }));

    test("out of order await (asynchronous catch) with concurrency", () =>
        testOrder({ childProcess: false, log: ignore, concurrency: 2, maxRetries: 0 }));

    test("out of order await (asynchronous catch) with child process and concurrency", () =>
        testOrder({ childProcess: true, log: ignore, concurrency: 2, maxRetries: 0 }));

    test("out of order await (asynchronous catch) with concurrency and retries", () =>
        testOrder({ childProcess: false, log: ignore, concurrency: 2, maxRetries: 2 }));

    test("out of order await (asynchronous catch) with child process and concurrency and retries", () =>
        testOrder({ childProcess: true, log: ignore, concurrency: 2, maxRetries: 2 }));

    test("console.log and console.warn with child process", async () => {
        const messages: string[] = [];
        const log = (msg: string) => {
            if (msg[msg.length - 1] === "\n") {
                msg = msg.slice(0, msg.length - 1);
            }
            messages.push(msg);
        };
        const { remote, cloudFunc } = await cloudify("immediate", funcs, "./functions", {
            childProcess: true,
            log
        });
        await remote.consoleLog("Remote console.log output");
        await remote.consoleWarn("Remote console.warn output");
        await remote.consoleError("Remote console.error output");

        expect(messages.find(m => m === "Remote console.log output")).toBeDefined();
        expect(messages.find(m => m === "Remote console.warn output")).toBeDefined();
        expect(messages.find(m => m === "Remote console.error output")).toBeDefined();

        await cloudFunc.cleanup();
    });

    test("concurrent executions with child processes", async () => {
        await testConcurrency({
            options: {
                childProcess: true,
                log: ignore
            },
            maxConcurrency: 5,
            expectedConcurrency: 5
        });
    });

    test("no concurrency for cpu bound work without child processes", async () => {
        await testConcurrency({
            options: {
                childProcess: false,
                log: ignore
            },
            maxConcurrency: 5,
            expectedConcurrency: 1
        });
    });
});
