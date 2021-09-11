import test from "ava";
import { Lambda } from "aws-sdk";
import { faast, faastAws, log } from "../index";
import * as funcs from "./fixtures/functions";

test("remote aws throttling to no concurrency", async t => {
    const faastModule = await faast("aws", funcs, {
        mode: "https",
        memorySize: 1024,
        concurrency: 1,
        gc: "off",
        description: t.title
    });
    try {
        const N = 10;
        const promises = [faastModule.functions.timer(1000)];
        for (let i = 1; i < N; i++) {
            promises.push(faastModule.functions.timer(1000));
        }
        const results = await Promise.all(promises);
        results.sort(({ start: a }, { start: b }) => a - b);
        log.info(results);
        let lastEnd = 0;
        // Executions should not overlap in their timestamps.
        for (const timing of results) {
            t.true(timing.start > lastEnd);
            lastEnd = timing.end;
        }
    } finally {
        await faastModule.cleanup();
    }
});

// Test the situation where the function concurrency isn't sufficient to handle
// all of the requests, and the events age out while in the queue.
test("remote aws async invocation queue throttling EventAgeExceeded", async t => {
    const lambda = await faastAws(funcs, {
        timeout: 70,
        maxRetries: 2,
        gc: "off",
        description: t.title,
        mode: "queue"
    });

    const { FunctionName } = lambda.state.resources;
    const awsLambda = new Lambda({ region: "us-west-2" });

    await awsLambda
        .putFunctionConcurrency({ FunctionName, ReservedConcurrentExecutions: 1 })
        .promise();

    await awsLambda
        .updateFunctionEventInvokeConfig({
            FunctionName,
            MaximumEventAgeInSeconds: 60
        })
        .promise();

    try {
        const invoke = () =>
            lambda.functions
                .sleep(65 * 1000)
                .then(_ => ({ value: "success" }))
                .catch(error => ({ error: error.message }));
        const firstPromise = invoke();
        const secondPromise = invoke();
        const first = await firstPromise;
        const second = await secondPromise;
        t.assert("value" in first || "value" in second);
        t.assert("error" in first || "error" in second);
    } finally {
        await lambda.cleanup();
    }
});
