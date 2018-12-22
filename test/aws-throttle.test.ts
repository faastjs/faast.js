import * as faast from "../src/faast";
import { info, warn } from "../src/log";
import * as funcs from "./functions";

describe("aws throttling to reduce concurrency", () => {
    let cloud: faast.AWS;
    let func: faast.AWSLambda;
    let remote: faast.Promisified<typeof funcs>;

    beforeAll(async () => {
        try {
            cloud = faast.create("aws");
            func = await cloud.createFunction("./functions", {
                // Timeout: 120
                mode: "https",
                memorySize: 1024,
                concurrency: 1
            });
            remote = func.wrapModule(funcs);
        } catch (err) {
            warn(err);
        }
    }, 90 * 1000);

    test(
        "no concurrency",
        async () => {
            const N = 10;
            const promises = [remote.timer(1000)];
            for (let i = 1; i < N; i++) {
                promises.push(remote.timer(1000));
            }
            const results = await Promise.all(promises);
            results.sort(({ start: a }, { start: b }) => a - b);
            info(results);
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
});
