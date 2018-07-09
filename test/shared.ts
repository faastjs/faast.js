import * as cloudify from "../src/cloudify";
import { Pump } from "../src/funnel";
import { log } from "../src/log";
import * as funcs from "./functions";
import { sleep } from "../src/shared";

export function checkFunctions(
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
                lambda = await cloud.createFunction("./functions", options);
                remote = lambda.cloudifyAll(funcs);
            } catch (err) {
                console.error(err);
            }
        }, 90 * 1000);

        afterAll(async () => {
            await lambda.cleanup();
        }, 60 * 1000);

        test("hello: string => string", async () => {
            expect(await remote.hello("Andy")).toBe("Hello Andy!");
        });

        test("fact: number => number", async () => {
            expect(await remote.fact(5)).toBe(120);
        });

        test("concat: (string, string) => string", async () => {
            expect(await remote.concat("abc", "def")).toBe("abcdef");
        });

        test("error: string => raise exception", async () => {
            expect(await remote.error("hey").catch(err => err.message)).toBe(
                "Expected this error. Argument: hey"
            );
        });

        test("noargs: () => string", async () => {
            expect(await remote.noargs()).toBe(
                "successfully called function with no args."
            );
        });

        test("async: () => Promise<string>", async () => {
            expect(await remote.async()).toBe(
                "returned successfully from async function"
            );
        });

        test("path: () => Promise<string>", async () => {
            expect(typeof (await remote.path())).toBe("string");
        });

        test("rejected: () => rejected promise", async () => {
            expect.assertions(1);
            await expect(remote.rejected()).rejects.toThrowError();
        });
    });
}

export const sum = (a: number[]) => a.reduce((total, n) => total + n, 0);
export const avg = (a: number[]) => sum(a) / a.length;

export const stdev = (a: number[]) => {
    const average = avg(a);
    return Math.sqrt(avg(a.map(v => (v - average) ** 2)));
};

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
                remote = lambda.cloudifyAll(funcs);
            } catch (err) {
                console.error(err);
            }
        }, 90 * 1000);

        afterAll(() => lambda.cleanup(), 60 * 1000);
        // afterAll(() => lambda.cancelAll(), 30 * 1000);

        function printLatencies(latencies: number[]) {
            const count = latencies.length;
            log(`%O`, {
                min: latencies[0],
                max: latencies[count - 1],
                median: latencies[Math.floor(count / 2)],
                average: avg(latencies),
                stdev: stdev(latencies)
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
    options?: cloudify.CreateFunctionOptions<any>
) {
    describe(description, () => {
        let lambda: cloudify.CloudFunction<any>;
        let remote: cloudify.Promisified<typeof funcs>;

        beforeAll(async () => {
            try {
                const cloud = cloudify.create(cloudProvider);
                lambda = await cloud.createFunction("./functions", options);
                remote = lambda.cloudifyAll(funcs);
            } catch (err) {
                console.error(err);
            }
        }, 90 * 1000);

        afterAll(() => lambda.cleanup(), 30 * 1000);

        test(
            "sustained load test for 1 minute",
            async () => {
                let completed = 0;
                const nSamplesPerFunction = 2000000;
                const start = Date.now();
                const pump = new Pump(500, () =>
                    remote.monteCarloPI(nSamplesPerFunction).then(_ => completed++)
                );
                pump.start();
                await sleep(60 * 1000);
                await pump.drain();
                console.log(`Completed ${completed} calls in 1 minute`);
            },
            90 * 1000
        );
    });
}
