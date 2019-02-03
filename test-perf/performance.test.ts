import test from "ava";
import { inspect } from "util";
import * as faast from "../src/faast";
import { faastify } from "../src/faast";
import { info, stats, warn } from "../src/log";
import { CommonOptions } from "../src/provider";
import { sleep } from "../src/shared";
import { Pump } from "../src/throttle";
import * as funcs from "../test/functions";
import { once } from "../test/util";

export function testThroughput(
    provider: faast.Provider,
    duration: number,
    concurrency: number = 500,
    options?: CommonOptions
) {
    const opts = inspect(options, { breakLength: Infinity });
    let lambda: faast.CloudFunction<typeof funcs>;

    const init = once(async () => {
        try {
            lambda = await faastify(provider, funcs, "../test/functions", {
                gc: false,
                ...options
            });
            lambda.on("stats", s => stats.log(s.toString()));
        } catch (err) {
            warn(err);
        }
    });

    test.after.always(() => lambda && lambda.cleanup());
    // test.after.always(() => lambda.cancelAll(), 30 * 1000);

    test.serial(`${provider} ${opts} sustained load test`, async () => {
        await init();
        let completed = 0;
        const nSamplesPerFunction = 100000000;
        const pump = new Pump(concurrency, () =>
            lambda.functions.monteCarloPI(nSamplesPerFunction).then(_ => completed++)
        );
        pump.start();
        await sleep(duration);
        await pump.drain();
        const cost = await lambda.costEstimate();
        info(`Stats: ${lambda.stats}`);
        info(`Counters: ${lambda.counters}`);

        info(`Cost:`);
        info(`${cost}`);
        info(`Completed ${completed} calls in ${duration / (60 * 1000)} minute(s)`);
    });
}

export function testRampUp(
    provider: faast.Provider,
    concurrency: number,
    options?: CommonOptions
) {
    const opts = inspect(options, { breakLength: Infinity });
    let lambda: faast.CloudFunction<typeof funcs>;
    const init = once(async () => {
        try {
            lambda = await faastify(provider, funcs, "../test/functions", {
                gc: false,
                ...options,
                concurrency
            });
            lambda.on("stats", s => stats.log(s.toString()));
        } catch (err) {
            warn(err);
        }
    });

    test.after.always(() => lambda && lambda.cleanup());

    test.serial(
        `${provider} ${opts} Monte Carlo estimate of PI using 1B samples and 500 invocations`,
        async t => {
            await init();
            const nParallelFunctions = 500;
            const nSamplesPerFunction = 2000000;
            const promises: Promise<funcs.MonteCarloReturn>[] = [];
            for (let i = 0; i < nParallelFunctions; i++) {
                promises.push(lambda.functions.monteCarloPI(nSamplesPerFunction));
            }

            const results = await Promise.all(promises);
            let insidePoints = 0;
            let samplePoints = 0;

            results.forEach(m => {
                insidePoints += m.inside;
                samplePoints += m.samples;
            });

            info(`Stats:\n${lambda.stats}`);
            info(`Counters:\n${lambda.counters}`);

            info(`inside: ${insidePoints}, samples: ${samplePoints}`);
            t.is(samplePoints, nParallelFunctions * nSamplesPerFunction);
            const estimatedPI = (insidePoints / samplePoints) * 4;
            info(`PI estimate: ${estimatedPI}`);
            t.is(Number(estimatedPI.toFixed(2)), 3.14);
            const cost = await lambda.costEstimate();
            info(`Cost: ${cost}`);
        }
    );
}
testRampUp("aws", 500, { memorySize: 1024, mode: "https" });
testRampUp("aws", 500, { memorySize: 1024, mode: "queue" });

testThroughput("aws", 180 * 1000, 500, { memorySize: 1728, mode: "https" });
testThroughput("aws", 180 * 1000, 500, { memorySize: 1728, mode: "queue" });

testRampUp("google", 200, { mode: "https", memorySize: 1024 });
testRampUp("google", 500, { mode: "queue", memorySize: 1024 });
testThroughput("google", 180 * 1000, 500, { memorySize: 2048, mode: "https" });
testThroughput("google", 180 * 1000, 500, { memorySize: 2048, mode: "queue" });

testThroughput("local", 60 * 1000, 16, { memorySize: 64 });
