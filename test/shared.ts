import { Promisified } from "../src/cloudify";
import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";

export function checkFunctions(
    description: string,
    cloudProvider: string,
    options?: cloudify.CreateFunctionOptions<any>
) {
    describe(description, () => {
        let remote: Promisified<typeof funcs>;
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

import { log } from "../src/log";
import { MonteCarloReturn } from "./functions";

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

        const sum = (a: number[]) => a.reduce((sum, n) => sum + n, 0);
        const avg = (a: number[]) => sum(a) / a.length;

        function printLatencies(latencies: number[]) {
            const count = latencies.length;
            const median = latencies[Math.floor(count / 2)];
            const [min, max] = [latencies[0], latencies[count - 1]];
            const average = avg(latencies);
            const stdev = Math.sqrt(avg(latencies.map(v => (v - average) ** 2)));
            log(`%O`, { min, max, median, average, stdev });
        }

        test(
            "Monte Carlo estimate of PI using 1B samples and 500 invocations",
            async () => {
                const nParallelFunctions = 500;
                const nSamplesPerFunction = 2000000;
                const promises: Promise<MonteCarloReturn & { returned: number }>[] = [];
                for (let i = 0; i < nParallelFunctions; i++) {
                    promises.push(
                        remote
                            .monteCarloPI(nSamplesPerFunction, Date.now())
                            .then(x => ({ ...x, returned: Date.now() }))
                    );
                }

                const results = await Promise.all(promises);
                let inside = 0;
                let samples = 0;

                let startLatencies: number[] = [];
                let executionLatencies: number[] = [];
                let returnLatencies: number[] = [];

                results.forEach(m => {
                    inside += m.inside;
                    samples += m.samples;
                    startLatencies.push(m.startLatency);
                    executionLatencies.push(m.end - m.start);
                    returnLatencies.push(m.returned - m.end);
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

                console.log(`inside: ${inside}, samples: ${samples}`);
                expect(samples).toBe(nParallelFunctions * nSamplesPerFunction);
                const estimatedPI = (inside / samples) * 4;
                console.log(`PI estimate: ${estimatedPI}`);
                expect(Number(estimatedPI.toFixed(2))).toBe(3.14);
            },
            600 * 1000
        );
    });
}
