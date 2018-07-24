import * as cloudify from "../src/cloudify";
import { log, warn } from "../src/log";
import * as funcs from "./functions";

let cloud: cloudify.AWS;
let func: cloudify.AWSLambda;
let remote: cloudify.Promisified<typeof funcs>;

beforeAll(async () => {
    try {
        cloud = cloudify.create("aws");
        func = await cloud.createFunction("./functions", {
            // Timeout: 120
            cloudSpecific: { useQueue: false },
            memorySize: 1024
        });
        await func.setConcurrency(1);
        remote = func.cloudifyAll(funcs);
    } catch (err) {
        warn(err);
    }
}, 90 * 1000);

test(
    "Throttling test with no concurrency",
    async () => {
        const N = 10;
        const promises = [remote.timer(1000)];
        for (let i = 1; i < N; i++) {
            promises.push(remote.timer(1000));
        }
        const results = await Promise.all(promises);
        results.sort(({ start: a }, { start: b }) => a - b);
        log(results);
        let lastEnd = 0;
        // Executions should not overlap in their timestamps.
        for (const timing of results) {
            expect(timing.start > lastEnd).toBe(true);
            lastEnd = timing.end;
        }
    },
    90 * 1000
);

afterAll(() => func.cleanup(), 30 * 1000);
// afterAll(() => lambda.cancelAll(), 30 * 1000);
