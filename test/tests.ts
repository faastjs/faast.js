import * as sys from "child_process";
import * as path from "path";
import { PassThrough } from "stream";
import * as awsCloudify from "../src/aws/aws-cloudify";
import * as cloudify from "../src/cloudify";
import { Pump } from "../src/funnel";
import * as googleCloudify from "../src/google/google-cloudify";
import { info, stats, warn } from "../src/log";
import { unzipInDir } from "../src/packer";
import { sleep } from "../src/shared";
import * as funcs from "./functions";
import { rmrf, createWriteStream, stat } from "../src/fs-promise";

export function testFunctions(cloudProvider: "aws", options: awsCloudify.Options): void;
export function testFunctions(
    cloudProvider: "local",
    options: cloudify.local.Options
): void;
export function testFunctions(
    cloudProvider: cloudify.CloudProvider,
    options: cloudify.CommonOptions
): void;
export function testFunctions(
    cloudProvider: cloudify.CloudProvider,
    options: cloudify.CommonOptions
): void {
    let remote: cloudify.Promisified<typeof funcs>;
    let cloudFunc: cloudify.AnyCloudFunction;

    beforeAll(async () => {
        try {
            const start = Date.now();
            const opts = { timeout: 30, memorySize: 512, ...options };
            ({ remote, cloudFunc } = await cloudify.cloudify(
                cloudProvider,
                funcs,
                "./functions",
                opts
            ));
            info(`Function creation took ${((Date.now() - start) / 1000).toFixed(1)}s`);
        } catch (err) {
            warn(err);
        }
    }, 180 * 1000);

    afterAll(async () => {
        await cloudFunc.cleanup();
        // await cloudFunc.stop();
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
        expect.assertions(1);
        try {
            const rv = await remote.error("hey");
        } catch (err) {
            expect(err.message).toMatch("Expected this error. Argument: hey");
        }
    });

    test("noargs: () => string", async () => {
        expect(await remote.noargs()).toBe("successfully called function with no args.");
    });

    test("async: () => Promise<string>", async () => {
        expect(await remote.async()).toBe("returned successfully from async function");
    });

    test("path: () => Promise<string>", async () => {
        expect(typeof (await remote.path())).toBe("string");
    });

    test("rejected: () => rejected promise", async () => {
        expect.assertions(1);
        try {
            await remote.rejected();
        } catch (err) {
            expect(err).toBe("This promise is intentionally rejected.");
        }
    });

    test("empty promise rejection", async () => {
        expect.assertions(1);
        try {
            await remote.emptyReject();
        } catch (err) {
            expect(err).toBeUndefined();
        }
    });

    test("promise args not supported", async () => {
        expect.assertions(1);
        try {
            await remote.promiseArg(Promise.resolve("hello"));
        } catch (err) {
            expect(err).toBeInstanceOf(Error);
        }
    });

    test("optional arguments are supported", async () => {
        expect(await remote.optionalArg()).toBe("No arg");
        expect(await remote.optionalArg("has arg")).toBe("has arg");
    });
}

function exec(cmd: string) {
    const result = sys.execSync(cmd).toString();
    info(result);
    return result;
}

export function testCodeBundle(
    cloudProvider: "aws",
    packageType: string,
    maxZipFileSize?: number,
    options?: awsCloudify.Options,
    expectations?: (root: string) => void
): void;
export function testCodeBundle(
    cloudProvider: "google" | "google-emulator",
    packageType: string,
    maxZipFileSize?: number,
    options?: googleCloudify.Options,
    expectations?: (root: string) => void
): void;
export function testCodeBundle(
    cloudProvider: cloudify.CloudProvider,
    packageType: string,
    maxZipFileSize?: number,
    options?: any,
    expectations?: (root: string) => void
) {
    test(
        "package zip file",
        async () => {
            const identifier = `func-${cloudProvider}-${packageType}`;
            const tmpDir = path.join("tmp", identifier);
            exec(`mkdir -p ${tmpDir}`);
            const { archive } = await cloudify
                .create(cloudProvider)
                .pack("./functions", options);

            const stream1 = archive.pipe(new PassThrough());
            const stream2 = archive.pipe(new PassThrough());

            const zipFile = path.join("tmp", identifier + ".zip");
            stream2.pipe(createWriteStream(zipFile));
            const writePromise = new Promise(resolve => stream2.on("end", resolve));

            await rmrf(tmpDir);
            const unzipPromise = unzipInDir(tmpDir, stream1);

            await Promise.all([writePromise, unzipPromise]);
            const bytes = (await stat(zipFile)).size;
            maxZipFileSize && expect(bytes).toBeLessThan(maxZipFileSize);
            expect(exec(`cd ${tmpDir} && node index.js`)).toMatch(
                "cloudify: successful cold start."
            );
            expectations && expectations(tmpDir);
        },
        30 * 1000
    );
}

export function testCosts(
    cloudProvider: cloudify.CloudProvider,
    options: cloudify.CommonOptions = {}
) {
    let remote: cloudify.Promisified<typeof funcs>;
    let cloudFunc: cloudify.AnyCloudFunction;

    beforeAll(async () => {
        const args: cloudify.CommonOptions = {
            timeout: 30,
            memorySize: 512,
            mode: "queue"
        };
        ({ remote, cloudFunc } = await cloudify.cloudify(
            cloudProvider,
            funcs,
            "./functions",
            { ...args, ...options }
        ));
    }, 120 * 1000);

    afterAll(async () => {
        await cloudFunc.cleanup();
        // await cloudFunc.stop();
    }, 60 * 1000);

    test(
        "cost for basic call",
        async () => {
            await remote.hello("there");
            const costs = await cloudFunc.costEstimate();
            info(`${costs}`);
            info(`CSV costs:\n${costs.csv()}`);

            const { estimatedBilledTime } = cloudFunc.functionStats.aggregate;
            expect((estimatedBilledTime.mean * estimatedBilledTime.samples) / 1000).toBe(
                costs.metrics.find(m => m.name === "functionCallDuration")!.measured
            );

            expect(costs.metrics.length).toBeGreaterThan(1);
            expect(costs.find("functionCallRequests")!.measured).toBe(1);
            for (const metric of costs.metrics) {
                if (!metric.alwaysZero) {
                    expect(metric.cost()).toBeGreaterThan(0);
                    expect(metric.measured).toBeGreaterThan(0);
                    expect(metric.pricing).toBeGreaterThan(0);
                }

                expect(metric.cost()).toBeLessThan(0.00001);
                expect(metric.name.length).toBeGreaterThan(0);
                expect(metric.unit.length).toBeGreaterThan(0);
                expect(metric.cost()).toBe(metric.pricing * metric.measured);
            }
            expect(costs.total()).toBeGreaterThan(0);
        },
        30 * 1000
    );
}

export function testRampUp(
    cloudProvider: cloudify.CloudProvider,
    maxConcurrency: number,
    options?: cloudify.CommonOptions
) {
    let lambda: cloudify.AnyCloudFunction;
    let remote: cloudify.Promisified<typeof funcs>;

    beforeAll(async () => {
        try {
            const cloud = cloudify.create(cloudProvider);
            lambda = await cloud.createFunction("./functions", options);
            lambda.setConcurrency(maxConcurrency);
            lambda.printStatisticsInterval(1000, stats);
            remote = lambda.cloudifyModule(funcs);
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

            info(`Stats:\n${lambda.functionStats}`);
            info(`Counters:\n${lambda.functionCounters}`);

            info(`inside: ${insidePoints}, samples: ${samplePoints}`);
            expect(samplePoints).toBe(nParallelFunctions * nSamplesPerFunction);
            const estimatedPI = (insidePoints / samplePoints) * 4;
            info(`PI estimate: ${estimatedPI}`);
            expect(Number(estimatedPI.toFixed(2))).toBe(3.14);
            const cost = await lambda.costEstimate();
            info(`Cost: ${cost}`);
        },
        600 * 1000
    );
}

export function testThroughput(
    cloudProvider: cloudify.CloudProvider,
    duration: number,
    concurrency: number = 500,
    options?: cloudify.CommonOptions
) {
    let lambda: cloudify.AnyCloudFunction;
    let remote: cloudify.Promisified<typeof funcs>;

    beforeAll(async () => {
        try {
            const cloud = cloudify.create(cloudProvider);
            lambda = await cloud.createFunction("./functions", options);
            lambda.printStatisticsInterval(1000, stats);
            remote = lambda.cloudifyModule(funcs);
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
            const nSamplesPerFunction = 100000000;
            const pump = new Pump(concurrency, () =>
                remote.monteCarloPI(nSamplesPerFunction).then(_ => completed++)
            );
            pump.start();
            await sleep(duration);
            await pump.drain();
            const cost = await lambda.costEstimate();
            info(`Stats: ${lambda.functionStats}`);
            info(`Counters: ${lambda.functionCounters}`);

            info(`Cost:`);
            info(`${cost}`);
            info(`Completed ${completed} calls in ${duration / (60 * 1000)} minute(s)`);
        },
        duration * 3
    );
}

export function testTimeout(
    cloudProvider: cloudify.CloudProvider,
    options?: cloudify.CommonOptions
) {
    let remote: cloudify.Promisified<typeof funcs>;
    let lambda: cloudify.AnyCloudFunction;

    beforeAll(async () => {
        try {
            const cloud = cloudify.create(cloudProvider);
            lambda = await cloud.createFunction("./functions", {
                ...options,
                timeout: 2,
                maxRetries: 0
            });
            remote = lambda.cloudifyModule(funcs);
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
            expect.assertions(1);
            try {
                await remote.sleep(4 * 1000);
            } catch (err) {
                expect(err.message).toMatch(/time/i);
            }
        },
        600 * 1000
    );
}

export function testMemoryLimit(
    cloudProvider: cloudify.CloudProvider,
    options?: cloudify.CommonOptions
) {
    let remote: cloudify.Promisified<typeof funcs>;
    let lambda: cloudify.AnyCloudFunction;

    beforeAll(async () => {
        try {
            const cloud = cloudify.create(cloudProvider);
            lambda = await cloud.createFunction("./functions", {
                ...options,
                timeout: 200,
                memorySize: 256,
                maxRetries: 0
            });
            remote = lambda.cloudifyModule(funcs);
        } catch (err) {
            warn(err);
        }
    }, 90 * 1000);

    afterAll(async () => {
        await lambda.cleanup();
        // await lambda.stop();
    }, 60 * 1000);

    test(
        "can allocate under memory limit",
        async () => {
            const bytes = (256 - 70) * 1024 * 1024;
            const rv = await remote.allocate(bytes);
            expect(rv.elems).toBe(bytes / 8);
        },
        300 * 1000
    );

    test(
        "out of memory error",
        async () => {
            expect.assertions(1);
            const bytes = 256 * 1024 * 1024;
            try {
                await remote.allocate(bytes);
            } catch (err) {
                expect(err.message).toMatch(/memory/i);
            }
        },
        600 * 1000
    );
}
