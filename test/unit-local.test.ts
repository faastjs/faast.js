import test, { ExecutionContext } from "ava";
import { readFile } from "fs-extra";
import { URL } from "url";
import { inspect } from "util";
import { faastLocal, LocalOptions } from "../index";
import * as funcs from "./fixtures/functions";
import { measureConcurrency, sleep } from "./fixtures/util";

async function testCleanup(t: ExecutionContext, options: LocalOptions) {
    const m = await faastLocal(funcs, {
        gc: "off",
        ...options
    });
    let done = 0;

    m.functions
        .hello("there")
        .then(_ => done++)
        .catch(_ => {});

    m.functions
        .sleep(1000)
        .then(_ => done++)
        .catch(_ => {});

    await m.cleanup();
    t.is(done, 0);
}

async function testOrder(t: ExecutionContext, options: LocalOptions) {
    const faastModule = await faastLocal(funcs, {
        gc: "off",
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
    const faastModule = await faastLocal(funcs, {
        ...options,
        gc: "off",
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
    const faastModule = await faastLocal(funcs, {
        childProcess: true,
        concurrency: 1,
        gc: "off"
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
        await faastModule.cleanup({ deleteResources: false });
    }
});

test("local provider log files should be appended, not truncated, after child process crash", async t => {
    const faastModule = await faastLocal(funcs, {
        childProcess: true,
        concurrency: 1,
        maxRetries: 1,
        gc: "off"
    });
    try {
        await faastModule.functions.consoleLog("output 1");
        try {
            await faastModule.functions.processExit();
        } catch (err) {}
        await faastModule.functions.consoleWarn("output 2");

        // Wait for flush
        await sleep(500);
        const messages = await readFirstLogfile(faastModule.logUrl());

        t.truthy(messages.find(s => s === "[$pid]: output 1"));
        t.truthy(messages.find(s => s === "[$pid]: output 2"));
    } finally {
        await faastModule.cleanup({ deleteResources: false });
    }
});

test("local provider child process exceptions should result in errors with logUrl", async t => {
    const faastModule = await faastLocal(funcs, {
        childProcess: true,
        concurrency: 1,
        maxRetries: 1,
        gc: "off"
    });
    t.plan(1);
    try {
        await faastModule.functions.error("synthetic error");
    } catch (err) {
        t.true(typeof err.logUrl === "string" && err.logUrl.startsWith(" file:///"));
    } finally {
        await faastModule.cleanup();
    }
});

test("local provider child process crashes should result in errors with logUrl", async t => {
    const faastModule = await faastLocal(funcs, {
        childProcess: true,
        concurrency: 1,
        maxRetries: 1,
        gc: "off"
    });
    t.plan(1);
    try {
        await faastModule.functions.processExit(-1);
    } catch (err) {
        t.true(typeof err.logUrl === "string" && err.logUrl.startsWith(" file:///"));
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
    const faastModule = await faastLocal(funcs, {
        childProcess: true,
        gc: "off"
    });
    faastModule.functions.spin(5000).catch(_ => {});
    while (true) {
        await sleep(100);
        if (faastModule.state.executors.length > 0) {
            break;
        }
    }
    t.is(faastModule.state.executors.length, 1);
    await faastModule.cleanup();
    t.is(faastModule.state.executors.length, 0);
});

test("local unresolved module", async t => {
    t.plan(1);
    try {
        await faastLocal({});
    } catch (err) {
        t.regex(err.message, /Could not find file/);
    }
});

test("local issue #37", async t => {
    // Previously this code caused an exception about module wrapper not being
    // re-entrant. The problem was a race condition between wrapper selection
    // and execution in local provider. Solved by making wrapper selector a
    // regular function instead of an async function.
    const m = await faastLocal(funcs);
    try {
        const { identityString: identity } = m.functions;
        await identity("a");
        const b = identity("b");
        const c = identity("c");
        await b;
        await c;
        // Test succeeds if no exceptions are thrown.
        t.true(true);
    } finally {
        await m.cleanup();
    }
});
