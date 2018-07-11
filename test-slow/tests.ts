import * as cloudify from "../src/cloudify";
import { Pump } from "../src/funnel";
import { log } from "../src/log";
import { sleep, Stats } from "../src/shared";
import * as funcs from "./functions";

export function coldStartTest(
    description: string,
    cloudProvider: string,
    maxConcurrency: number,
    options?: cloudify.CreateFunctionOptions<any>
) {
    let lambda: cloudify.CloudFunction<any>;
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
                console.error(err);
            }
        }, 90 * 1000);

        afterAll(() => lambda.cleanup(), 60 * 1000);
        // afterAll(() => lambda.cancelAll(), 30 * 1000);

        function printLatencies(latencies: number[]) {
            const stats = new Stats();
            latencies.forEach(l => stats.update(l));
            const { samples, mean, stdev, min, max } = stats;
            log(`%O`, {
                samples,
                mean,
                stdev,
                min,
                max
            });
        }

        test(
            "Monte Carlo estimate of PI using 1B samples and 500 invocations",
            async () => {
                const nParallelFunctions = 500;
                const nSamplesPerFunction = 2000000;
                const promises: Promise<{
                    inside: number;
                    samples: number;
                    startLatency: number;
                    executionLatency: number;
                    returnLatency: number;
                }>[] = [];
                for (let i = 0; i < nParallelFunctions; i++) {
                    const requested = Date.now();
                    promises.push(
                        remote
                            .monteCarloPI(nSamplesPerFunction)
                            .then(({ inside, samples, start, end }) => ({
                                inside,
                                samples,
                                startLatency: start - requested,
                                executionLatency: end - start,
                                returnLatency: Date.now() - end
                            }))
                    );
                }

                const results = await Promise.all(promises);
                let insidePoints = 0;
                let samplePoints = 0;

                const startLatencies: number[] = [];
                const executionLatencies: number[] = [];
                const returnLatencies: number[] = [];

                results.forEach(m => {
                    insidePoints += m.inside;
                    samplePoints += m.samples;
                    startLatencies.push(m.startLatency);
                    executionLatencies.push(m.executionLatency);
                    returnLatencies.push(m.returnLatency);
                });

                startLatencies.sort((a, b) => a - b);
                executionLatencies.sort((a, b) => a - b);
                returnLatencies.sort((a, b) => a - b);

                log(`Start latencies:`);
                printLatencies(startLatencies);
                log(`Execution latencies: `);
                printLatencies(executionLatencies);
                log(`Return latencies:`);
                printLatencies(returnLatencies);

                console.log(`inside: ${insidePoints}, samples: ${samplePoints}`);
                expect(samplePoints).toBe(nParallelFunctions * nSamplesPerFunction);
                const estimatedPI = (insidePoints / samplePoints) * 4;
                console.log(`PI estimate: ${estimatedPI}`);
                expect(Number(estimatedPI.toFixed(2))).toBe(3.14);
            },
            600 * 1000
        );
    });
}

export function throughputTest(
    description: string,
    cloudProvider: string,
    duration: number,
    options?: cloudify.CreateFunctionOptions<any>
) {
    describe(description, () => {
        let lambda: cloudify.CloudFunction<any>;
        let remote: cloudify.Promisified<typeof funcs>;

        beforeAll(async () => {
            try {
                const cloud = cloudify.create(cloudProvider);
                lambda = await cloud.createFunction("./functions", options);
                lambda.printStatisticsInterval(1000);
                remote = lambda.cloudifyAll(funcs);
            } catch (err) {
                console.error(err);
            }
        }, 90 * 1000);

        afterAll(() => lambda.cleanup(), 30 * 1000);
        // afterAll(() => lambda.cancelAll(), 30 * 1000);

        test(
            "sustained load test",
            async () => {
                let completed = 0;
                const nSamplesPerFunction = 2000000;
                const start = Date.now();
                const pump = new Pump(500, () =>
                    remote.monteCarloPI(nSamplesPerFunction).then(_ => completed++)
                );
                pump.start();
                await sleep(duration);
                await pump.drain();
                console.log(
                    `Completed ${completed} calls in ${duration / (60 * 1000)} minute(s)`
                );
            },
            duration * 2
        );
    });
}

export function checkTimeout(
    description: string,
    cloudProvider: string,
    options?: cloudify.CreateFunctionOptions<any>
) {
    describe(description, () => {
        let remote: cloudify.Promisified<typeof funcs>;
        let lambda: cloudify.CloudFunction<any>;

        beforeAll(async () => {
            try {
                const cloud = cloudify.create(cloudProvider);
                lambda = await cloud.createFunction("./functions", {
                    ...options,
                    timeout: 3
                });
                remote = lambda.cloudifyAll(funcs);
            } catch (err) {
                console.error(err);
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
    cloudProvider: string,
    options?: cloudify.CreateFunctionOptions<any>
) {
    describe(description, () => {
        let remote: cloudify.Promisified<typeof funcs>;
        let lambda: cloudify.CloudFunction<any>;

        beforeAll(async () => {
            try {
                const cloud = cloudify.create(cloudProvider);
                lambda = await cloud.createFunction("./functions", {
                    ...options,
                    timeout: 200,
                    memorySize: 512
                });
                remote = lambda.cloudifyAll(funcs);
            } catch (err) {
                console.error(err);
            }
        }, 90 * 1000);

        afterAll(async () => {
            await lambda.cleanup();
            // await lambda.stop();
        }, 60 * 1000);

        test(
            "out of memory error",
            async () => {
                const bytes = 512 * 1024 * 1024;
                await expect(remote.allocate(bytes)).rejects.toThrowError(/memory/i);
            },
            600 * 1000
        );
    });
}
