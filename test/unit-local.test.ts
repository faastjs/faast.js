import test, { ExecutionContext } from "ava";
import { readFile } from "fs-extra";
import { URL } from "url";
import { inspect } from "util";
import { faastLocal, LocalOptions } from "../index";
import * as funcs from "./fixtures/functions";
import { measureConcurrency, sleep } from "./fixtures/util";

async function testCleanup(t: ExecutionContext, options: LocalOptions) {
    const faastModule = await faastLocal(funcs, "./fixtures/functions", {
        gc: false,
        ...options
    });
    const { hello, sleep } = faastModule.functions;
    let done = 0;

    hello("there")
        .then(_ => done++)
        .catch(_ => {});

    sleep(1000)
        .then(_ => done++)
        .catch(_ => {});

    await faastModule.cleanup();
    t.is(done, 0);
}

async function testOrder(t: ExecutionContext, options: LocalOptions) {
    const faastModule = await faastLocal(funcs, "./fixtures/functions", {
        gc: false,
        ...options
    });
    t.plan(2);

    const a = faastModule.functions.emptyReject();
    const b = faastModule.functions.sleep(0);
    t.is(await b, undefined);
    try {
        await a;
    } catch (err) {
        t.is(err, undefined);
    } finally {
        await faastModule.cleanup();
    }
}

async function testConcurrency(
    t: ExecutionContext,
    {
        options,
        maxConcurrency,
        expectedConcurrency
    }: {
        options: LocalOptions;
        maxConcurrency: number;
        expectedConcurrency: number;
    }
) {
    const faastModule = await faastLocal(funcs, "./fixtures/functions", {
        ...options,
        gc: false,
        concurrency: maxConcurrency
    });

    try {
        const N = maxConcurrency * 2;
        const promises = [];
        for (let i = 0; i < N; i++) {
            promises.push(faastModule.functions.spin(500));
        }

        const timings = await Promise.all(promises);
        t.is(measureConcurrency(timings), expectedConcurrency);
    } finally {
        await faastModule.cleanup();
    }
}

test("local provider cleanup stops executions", testCleanup, {});
test("local provider cleanup stops executions with child process", testCleanup, {
    childProcess: true
});

const orderConfigs = [
    { childProcess: false, concurrency: 1, maxRetries: 0 },
    { childProcess: true, concurrency: 1, maxRetries: 0 },
    { childProcess: false, concurrency: 2, maxRetries: 0 },
    { childProcess: true, concurrency: 2, maxRetries: 0 },
    { childProcess: false, concurrency: 2, maxRetries: 2 },
    { childProcess: true, concurrency: 2, maxRetries: 2 }
];

for (const config of orderConfigs) {
    test(`out of order await (async catch) with ${inspect(config)}`, testOrder, config);
}

async function readFirstLogfile(logDirectoryUrl: string) {
    const url = new URL(logDirectoryUrl);
    const buf = await readFile(url.pathname + "/0.log");
    return buf
        .toString()
        .split("\n")
        .map(m => m.replace(/^\[(\d+)\]/, "[$pid]"));
}

test("local provider console.log, console.warn, and console.error with child process", async t => {
    const faastModule = await faastLocal(funcs, "./fixtures/functions", {
        childProcess: true,
        concurrency: 1,
        gc: false
    });
    try {
        await faastModule.functions.consoleLog("Remote console.log output");
        await faastModule.functions.consoleWarn("Remote console.warn output");
        await faastModule.functions.consoleError("Remote console.error output");
        await sleep(1000);
        await faastModule.cleanup({ deleteResources: false });
        const messages = await readFirstLogfile(faastModule.logUrl());
        t.truthy(messages.find(s => s === "[$pid]: Remote console.log output"));
        t.truthy(messages.find(s => s === "[$pid]: Remote console.warn output"));
        t.truthy(messages.find(s => s === "[$pid]: Remote console.error output"));
    } finally {
        await faastModule.cleanup();
    }
});

test("local provider log files should be appended, not truncated, after child process crash", async t => {
    const faastModule = await faastLocal(funcs, "./fixtures/functions", {
        childProcess: true,
        concurrency: 1,
        maxRetries: 1,
        gc: false
    });
    try {
        await faastModule.functions.consoleLog("output 1");
        try {
            await faastModule.functions.processExit();
        } catch (err) {}
        await faastModule.functions.consoleWarn("output 2");

        const messages = await readFirstLogfile(faastModule.logUrl());

        t.truthy(messages.find(s => s === "[$pid]: output 1"));
        t.truthy(messages.find(s => s === "[$pid]: output 2"));
    } finally {
        await faastModule.cleanup();
    }
});

test("local provider concurrent executions with child processes", async t => {
    await testConcurrency(t, {
        options: {
            childProcess: true
        },
        maxConcurrency: 5,
        expectedConcurrency: 5
    });
});

test("local provider no concurrency for cpu bound work without child processes", async t => {
    await testConcurrency(t, {
        options: {
            childProcess: false
        },
        maxConcurrency: 5,
        expectedConcurrency: 1
    });
});

test("local provider cleanup waits for all child processes to exit", async t => {
    const faastModule = await faastLocal(funcs, "./fixtures/functions", {
        childProcess: true,
        gc: false
    });
    faastModule.functions.spin(5000).catch(_ => {});
    while (true) {
        await sleep(100);
        if (faastModule.state.wrappers.length > 0) {
            break;
        }
    }
    t.is(faastModule.state.wrappers.length, 1);
    await faastModule.cleanup();
    t.is(faastModule.state.wrappers.length, 0);
});
