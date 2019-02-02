import * as faast from "../src/faast";
import { info, warn } from "../src/log";
import * as funcs from "./functions";
import { once } from "./util";
import test from "ava";

let cloudFunc: faast.CloudFunction<typeof funcs>;
const init = once(async () => {
    try {
        cloudFunc = await faast.faastify("aws", funcs, "./functions", {
            mode: "https",
            memorySize: 1024,
            concurrency: 1
        });
    } catch (err) {
        warn(err);
    }
});

test("aws throttling to no concurrency", async t => {
    await init();
    const N = 10;
    const promises = [cloudFunc.functions.timer(1000)];
    for (let i = 1; i < N; i++) {
        promises.push(cloudFunc.functions.timer(1000));
    }
    const results = await Promise.all(promises);
    results.sort(({ start: a }, { start: b }) => a - b);
    info(results);
    let lastEnd = 0;
    // Executions should not overlap in their timestamps.
    for (const timing of results) {
        t.true(timing.start > lastEnd);
        lastEnd = timing.end;
    }
});

test.after.always(() => cloudFunc && cloudFunc.cleanup());
