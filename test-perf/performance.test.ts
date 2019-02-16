import test, { ExecutionContext } from "ava";
import { faastify, Provider } from "../src/faast";
import { info, stats } from "../src/log";
import { CommonOptions } from "../src/provider";
import { sleep } from "../src/shared";
import { Pump } from "../src/throttle";
import * as funcs from "../test/functions";
import { title } from "../test/util";

export async function throughput(
    t: ExecutionContext,
    provider: Provider,
    duration: number,
    concurrency: number = 500,
    options?: CommonOptions
) {
    const lambda = await faastify(provider, funcs, "../test/functions", {
        gc: false,
        ...options
    });
    lambda.on("stats", s => stats.log(s.toString()));

    try {
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
    } finally {
        await lambda.cleanup();
    }
}

throughput.title = (
    _: string,
    provider: Provider,
    duration: number,
    concurrency: number,
    opts: CommonOptions
) => title(provider, `sustained load test`, { ...opts, concurrency, duration });

export async function rampUp(
    t: ExecutionContext,
    provider: Provider,
    concurrency: number,
    options?: CommonOptions
) {
    const lambda = await faastify(provider, funcs, "../test/functions", {
        gc: false,
        ...options,
        concurrency
    });
    lambda.on("stats", s => stats.log(s.toString()));

    try {
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
    } finally {
        await lambda.cleanup();
    }
}

rampUp.title = (
    _: string,
    provider: Provider,
    concurrency: number,
    opts?: CommonOptions
) =>
    title(provider, `Monte Carlo estimate of PI using 1B samples`, {
        ...opts,
        concurrency
    });

test.serial(rampUp, "aws", 500, { memorySize: 1024, mode: "https" });
test.serial(rampUp, "aws", 500, { memorySize: 1024, mode: "queue" });

test.serial(throughput, "aws", 180 * 1000, 500, { memorySize: 1728, mode: "https" });
test.serial(throughput, "aws", 180 * 1000, 500, { memorySize: 1728, mode: "queue" });

test.serial(rampUp, "google", 200, { mode: "https", memorySize: 1024 });
test.serial(rampUp, "google", 500, { mode: "queue", memorySize: 1024 });

test.serial(throughput, "google", 180 * 1000, 500, { memorySize: 2048, mode: "https" });
test.serial(throughput, "google", 180 * 1000, 500, { memorySize: 2048, mode: "queue" });
test.serial(throughput, "local", 60 * 1000, 16, { memorySize: 64 });
