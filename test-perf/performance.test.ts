import test, { ExecutionContext } from "ava";
import { CommonOptions, faast, Provider, providers } from "../index";
import * as funcs from "../test/fixtures/functions";
import { sleep, title } from "../test/fixtures/util";
import { Pump } from "../src/throttle";

async function throughput(
    _: ExecutionContext,
    provider: Provider,
    options: CommonOptions & { duration: number }
) {
    const lambda = await faast(provider, funcs, "../test/fixtures/functions", {
        gc: "off",
        ...options
    });
    lambda.on("stats", s => console.log(s.toString()));

    try {
        let completed = 0;
        const nSamplesPerFunction = 100000000;
        const pump = new Pump(options.concurrency!, () =>
            lambda.functions.monteCarloPI(nSamplesPerFunction).then(() => completed++)
        );
        pump.start();
        await sleep(options.duration);
        await pump.drain();
        const cost = await lambda.costSnapshot();
        console.log(`Stats: ${lambda.stats()}`);
        console.log(`Cost:`);
        console.log(`${cost}`);
        console.log(
            `Completed ${completed} calls in ${options.duration / (60 * 1000)} minute(s)`
        );
    } finally {
        await lambda.cleanup();
    }
}

async function rampUp(t: ExecutionContext, provider: Provider, options: CommonOptions) {
    const lambda = await faast(provider, funcs, "../test/fixtures/functions", {
        gc: "off",
        ...options
    });
    lambda.on("stats", s => console.log(s.toString()));

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

        console.log(`Stats:\n${lambda.stats()}`);
        console.log(`inside: ${insidePoints}, samples: ${samplePoints}`);
        t.is(samplePoints, nParallelFunctions * nSamplesPerFunction);
        const estimatedPI = (insidePoints / samplePoints) * 4;
        console.log(`PI estimate: ${estimatedPI}`);
        t.is(Number(estimatedPI.toFixed(2)), 3.14);
        const cost = await lambda.costSnapshot();
        console.log(`Cost: ${cost}`);
    } finally {
        await lambda.cleanup();
    }
}

const rampUpConfigurations = [
    { memorySize: 1024, mode: "https", concurrency: 500 },
    { memorySize: 1024, mode: "queue", concurrency: 500 }
];

for (const provider of providers) {
    for (const config of rampUpConfigurations) {
        test.serial(title(provider, "ramp up", config), rampUp, provider, config);
    }
}

const throughputConfigurations = [
    { memorySize: 2048, mode: "https", concurrency: 500, duration: 180 * 1000 },
    { memorySize: 2048, mode: "queue", concurrency: 500, duration: 180 * 1000 }
];

for (const provider of providers) {
    for (const config of throughputConfigurations) {
        test.serial(
            title(provider, "throughput load test", config),
            throughput,
            provider,
            config
        );
    }
}

test.serial(throughput, "local", 60 * 1000, 16, { memorySize: 64 });
