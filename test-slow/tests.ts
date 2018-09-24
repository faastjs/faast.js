import * as cloudify from "../src/cloudify";
import { Pump } from "../src/funnel";
import { log, warn } from "../src/log";
import { sleep } from "../src/shared";
import * as funcs from "./functions";

export function coldStartTest(
    description: string,
    cloudProvider: cloudify.CloudProvider,
    maxConcurrency: number,
    options?: cloudify.CommonOptions
) {
    let lambda: cloudify.AnyCloudFunction;
    let remote: cloudify.Promisified<typeof funcs>;

    describe(description, () => {
        beforeAll(async () => {
            try {
                const cloud = cloudify.create(cloudProvider);
                lambda = await cloud.createFunction("./functions", options);
                lambda.setConcurrency(maxConcurrency);
                lambda.printStatisticsInterval(1000);
                remote = lambda.cloudifyAll(funcs);
            } catch (err) {
                warn(err);
            }
        }, 90 * 1000);

        afterAll(() => lambda.cleanup(), 60 * 1000);
        // afterAll(() => lambda.cancelAll(), 30 * 1000);

        test(
            "Monte Carlo estimate of PI using 1B samples and 500 invocations",
            async () => {
                const nParallelFunctions = 500;
                const nSamplesPerFunction = 2000000;
                const promises: Promise<funcs.MonteCarloReturn>[] = [];
                for (let i = 0; i < nParallelFunctions; i++) {
                    promises.push(remote.monteCarloPI(nSamplesPerFunction));
                }

                const results = await Promise.all(promises);
                let insidePoints = 0;
                let samplePoints = 0;

                results.forEach(m => {
                    insidePoints += m.inside;
                    samplePoints += m.samples;
                });

                log(`Stats:\n${lambda.functionStats}`);
                log(`Counters:\n${lambda.functionCounters}`);

                log(`inside: ${insidePoints}, samples: ${samplePoints}`);
                expect(samplePoints).toBe(nParallelFunctions * nSamplesPerFunction);
                const estimatedPI = (insidePoints / samplePoints) * 4;
                log(`PI estimate: ${estimatedPI}`);
                expect(Number(estimatedPI.toFixed(2))).toBe(3.14);
                const cost = await lambda.costEstimate();
                log(`Cost: ${cost}`);
            },
            600 * 1000
        );
    });
}

export function throughputTest(
    description: string,
    cloudProvider: cloudify.CloudProvider,
    duration: number,
    concurrency: number = 500,
    options?: cloudify.CommonOptions
) {
    describe(description, () => {
        let lambda: cloudify.AnyCloudFunction;
        let remote: cloudify.Promisified<typeof funcs>;

        beforeAll(async () => {
            try {
                const cloud = cloudify.create(cloudProvider);
                lambda = await cloud.createFunction("./functions", options);
                lambda.printStatisticsInterval(1000);
                remote = lambda.cloudifyAll(funcs);
                // lambda.setLogger(console.log);
            } catch (err) {
                warn(err);
            }
        }, 120 * 1000);

        afterAll(() => lambda.cleanup(), 60 * 1000);
        // afterAll(() => lambda.cancelAll(), 30 * 1000);

        test(
            "sustained load test",
            async () => {
                let completed = 0;
                const nSamplesPerFunction = 2000000;
                const pump = new Pump(concurrency, () =>
                    remote.monteCarloPI(nSamplesPerFunction).then(_ => completed++)
                );
                pump.start();
                await sleep(duration);
                await pump.drain();
                const cost = await lambda.costEstimate();
                log(`Stats: ${lambda.functionStats}`);
                log(`Counters: ${lambda.functionCounters}`);

                log(`Cost:`);
                log(`${cost}`);
                log(
                    `Completed ${completed} calls in ${duration / (60 * 1000)} minute(s)`
                );
            },
            duration * 3
        );
    });
}

export function checkTimeout(
    description: string,
    cloudProvider: cloudify.CloudProvider,
    options?: cloudify.CommonOptions
) {
    describe(description, () => {
        let remote: cloudify.Promisified<typeof funcs>;
        let lambda: cloudify.AnyCloudFunction;

        beforeAll(async () => {
            try {
                const cloud = cloudify.create(cloudProvider);
                lambda = await cloud.createFunction("./functions", {
                    ...options,
                    timeout: 3
                });
                remote = lambda.cloudifyAll(funcs);
                // lambda.setLogger(console.log);
            } catch (err) {
                warn(err);
            }
        }, 90 * 1000);

        afterAll(async () => {
            await lambda.cleanup();
            // await lambda.stop();
        }, 60 * 1000);

        test(
            "timeout error",
            async () => {
                await expect(remote.delay(4 * 1000)).rejects.toThrowError(/time/i);
            },
            600 * 1000
        );
    });
}

export function checkMemoryLimit(
    description: string,
    cloudProvider: cloudify.CloudProvider,
    options?: cloudify.CommonOptions
) {
    describe(description, () => {
        let remote: cloudify.Promisified<typeof funcs>;
        let lambda: cloudify.AnyCloudFunction;

        beforeAll(async () => {
            try {
                const cloud = cloudify.create(cloudProvider);
                lambda = await cloud.createFunction("./functions", {
                    ...options,
                    timeout: 200,
                    memorySize: 256
                });
                remote = lambda.cloudifyAll(funcs);
            } catch (err) {
                warn(err);
            }
        }, 90 * 1000);

        afterAll(async () => {
            await lambda.cleanup();
            // await lambda.stop();
        }, 60 * 1000);

        test(
            "out of memory error",
            async () => {
                const bytes = 256 * 1024 * 1024;
                await expect(remote.allocate(bytes)).rejects.toThrowError(/memory/i);
            },
            600 * 1000
        );
    });
}
