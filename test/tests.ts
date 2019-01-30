import * as sys from "child_process";
import * as path from "path";
import { PassThrough } from "stream";
import * as awsFaast from "../src/aws/aws-faast";
import * as faast from "../src/faast";
import { faastify } from "../src/faast";
import { createWriteStream, rmrf, stat } from "../src/fs";
import { info, stats, warn, logGc } from "../src/log";
import { unzipInDir } from "../src/packer";
import { sleep, keys, Statistics } from "../src/shared";
import { Pump } from "../src/throttle";
import * as funcs from "./functions";
import { Fn } from "../src/types";
import { CloudFunctionImpl, CommonOptions } from "../src/provider";

export function testFunctions(
    provider: "aws",
    options: awsFaast.Options,
    initTimeout?: number
): void;
export function testFunctions(
    provider: "local",
    options: faast.local.Options,
    initTimeout?: number
): void;
export function testFunctions(
    provider: faast.Provider,
    options: CommonOptions,
    initTimeout?: number
): void;
export function testFunctions(
    provider: faast.Provider,
    options: CommonOptions,
    initTimeout = 60 * 1000
): void {
    let cloudFunc: faast.CloudFunction<typeof funcs>;
    let remote: faast.Promisified<typeof funcs>;

    beforeAll(async () => {
        try {
            const start = Date.now();
            const opts = { timeout: 30, memorySize: 512, gc: false, ...options };
            cloudFunc = await faastify(provider, funcs, "./functions", opts);
            remote = cloudFunc.functions;
            info(`Function creation took ${((Date.now() - start) / 1000).toFixed(1)}s`);
        } catch (err) {
            warn(err);
        }
    }, initTimeout);

    afterAll(async () => {
        await cloudFunc.cleanup();
    }, initTimeout);

    test("hello: string => string", async () => {
        expect(await remote.hello("Andy")).toBe("Hello Andy!");
    });

    test("multibyte characters in arguments and return value", async () => {
        expect(await remote.identity("你好")).toBe("你好");
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

export function testCodeBundle<O, S>(
    cloud: CloudFunctionImpl<O, S>,
    packageType: string,
    maxZipFileSize?: number,
    options?: O,
    expectations?: (root: string) => void
) {
    test(
        "package zip file",
        async () => {
            const identifier = `func-${cloud.provider}-${packageType}`;
            const tmpDir = path.join("tmp", identifier);
            exec(`mkdir -p ${tmpDir}`);

            const { archive } = await cloud.pack(require.resolve("./functions"), options);

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
                "faast: successful cold start."
            );
            expectations && expectations(tmpDir);
        },
        30 * 1000
    );
}

export function testCosts(provider: faast.Provider, options: CommonOptions = {}) {
    let cloudFunc: faast.CloudFunction<typeof funcs>;

    beforeAll(async () => {
        const args: CommonOptions = {
            timeout: 30,
            memorySize: 512,
            mode: "queue",
            gc: false
        };
        cloudFunc = await faastify(provider, funcs, "./functions", {
            ...args,
            ...options
        });
    }, 120 * 1000);

    afterAll(async () => {
        await cloudFunc.cleanup();
    }, 60 * 1000);

    test(
        "cost for basic call",
        async () => {
            await cloudFunc.functions.hello("there");
            const costs = await cloudFunc.costEstimate();
            info(`${costs}`);
            info(`CSV costs:\n${costs.csv()}`);

            const { estimatedBilledTime } = cloudFunc.stats.aggregate;
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
    provider: faast.Provider,
    concurrency: number,
    options?: CommonOptions
) {
    let lambda: faast.CloudFunction<typeof funcs>;

    beforeAll(async () => {
        try {
            lambda = await faastify(provider, funcs, "./functions", {
                gc: false,
                ...options,
                concurrency
            });
            lambda.on("stats", s => stats.log(s.toString()));
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
    provider: faast.Provider,
    duration: number,
    concurrency: number = 500,
    options?: CommonOptions
) {
    let lambda: faast.CloudFunction<typeof funcs>;

    beforeAll(async () => {
        try {
            lambda = await faastify(provider, funcs, "./functions", {
                gc: false,
                ...options
            });
            lambda.on("stats", s => stats.log(s.toString()));
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
        },
        duration * 3
    );
}

export function testTimeout(provider: faast.Provider, options?: CommonOptions) {
    let lambda: faast.CloudFunction<typeof funcs>;

    beforeAll(async () => {
        try {
            lambda = await faastify(provider, funcs, "./functions", {
                ...options,
                timeout: 2,
                maxRetries: 0,
                gc: false
            });
        } catch (err) {
            warn(err);
        }
    }, 90 * 1000);

    afterAll(async () => {
        await lambda.cleanup();
    }, 60 * 1000);

    test(
        "timeout error",
        async () => {
            expect.assertions(1);
            try {
                await lambda.functions.sleep(4 * 1000);
            } catch (err) {
                expect(err.message).toMatch(/time/i);
            }
        },
        600 * 1000
    );
}

export function testMemoryLimit(provider: faast.Provider, options?: CommonOptions) {
    let lambda: faast.CloudFunction<typeof funcs>;

    beforeAll(async () => {
        try {
            lambda = await faastify(provider, funcs, "./functions", {
                ...options,
                timeout: 200,
                memorySize: 512,
                maxRetries: 0,
                gc: false
            });
        } catch (err) {
            warn(err);
        }
    }, 90 * 1000);

    afterAll(async () => {
        await lambda.cleanup();
    }, 60 * 1000);

    test(
        "can allocate under memory limit",
        async () => {
            const bytes = 64 * 1024 * 1024;
            const rv = await lambda.functions.allocate(bytes);
            expect(rv.elems).toBe(bytes / 8);
        },
        300 * 1000
    );

    test(
        "out of memory error",
        async () => {
            expect.assertions(1);
            const bytes = 512 * 1024 * 1024;
            try {
                await lambda.functions.allocate(bytes);
            } catch (err) {
                expect(err.message).toMatch(/memory/i);
            }
        },
        600 * 1000
    );
}

export function testCpuMetrics(provider: faast.Provider, options?: CommonOptions) {
    let lambda: faast.CloudFunction<typeof funcs>;

    beforeAll(async () => {
        try {
            lambda = await faastify(provider, funcs, "./functions", {
                childProcess: true,
                timeout: 30,
                memorySize: 512,
                maxRetries: 0,
                gc: false,
                ...options
            });
        } catch (err) {
            warn(err);
        }
    }, 90 * 1000);

    afterAll(async () => {
        await lambda.cleanup();
    }, 60 * 1000);

    test("cpu metrics are received", async () => {
        const N = 5;
        const NSec = 5;
        const promises: Promise<unknown>[] = [];
        for (let i = 0; i < N; i++) {
            promises.push(lambda.functions.spin(NSec * 1000));
        }
        await Promise.all(promises);
        const usage = lambda.cpuUsage.get("spin");
        expect(usage).toBeDefined();
        expect(usage!.size).toBeGreaterThan(0);
        expect(usage!.get(1)!.stime).toBeInstanceOf(Statistics);
        expect(usage!.get(1)!.utime).toBeInstanceOf(Statistics);
    }, 15000);
}

export function testCancellation(provider: faast.Provider, options?: CommonOptions) {
    test(
        "cleanup waits for all child processes to exit",
        async () => {
            const cloudFunc = await faastify(provider, funcs, "./functions", {
                ...options,
                childProcess: true
            });
            cloudFunc.functions.spin(10000).catch(_ => {});
            await sleep(1000);
            await cloudFunc.cleanup();
            // XXX use async hooks to determine if any hooks remain after cleanup.
        },
        120 * 1000
    );
}

export function quietly<T>(p: Promise<T>) {
    return p.catch(_ => {});
}

export async function getAWSResources(func: faast.AWSLambda) {
    const { lambda, sns, sqs, s3 } = func.state.services;
    const {
        FunctionName,
        RoleName,
        region,
        SNSLambdaSubscriptionArn,
        RequestTopicArn,
        ResponseQueueUrl,
        ResponseQueueArn,
        s3Bucket,
        s3Key,
        logGroupName,
        ...rest
    } = func.state.resources;

    const _exhaustiveCheck: Required<typeof rest> = {};

    const functionResult = await quietly(
        lambda.getFunctionConfiguration({ FunctionName }).promise()
    );
    const snsResult = await quietly(
        sns.getTopicAttributes({ TopicArn: RequestTopicArn! }).promise()
    );
    const sqsResult = await quietly(
        sqs.getQueueAttributes({ QueueUrl: ResponseQueueUrl! }).promise()
    );

    const subscriptionResult = await quietly(
        sns.listSubscriptionsByTopic({ TopicArn: RequestTopicArn! }).promise()
    );

    const s3Result = await quietly(
        s3.getObject({ Bucket: s3Bucket!, Key: s3Key! }).promise()
    );

    if (
        logGroupName ||
        RoleName ||
        SNSLambdaSubscriptionArn ||
        region ||
        ResponseQueueArn
    ) {
        // ignore
    }

    return {
        functionResult,
        snsResult,
        sqsResult,
        subscriptionResult,
        s3Result
    };
}

export async function getGoogleResources(func: faast.GoogleCloudFunction) {
    const { cloudFunctions, pubsub } = func.state.services;
    const {
        trampoline,
        isEmulator,
        requestQueueTopic,
        responseQueueTopic,
        responseSubscription,
        region,
        ...rest
    } = func.state.resources;
    const _exhaustiveCheck: Required<typeof rest> = {};

    const functionResult = await quietly(
        cloudFunctions.projects.locations.functions.get({
            name: trampoline
        })
    );

    const requestQueueResult = await quietly(
        pubsub.projects.topics.get({
            topic: requestQueueTopic
        })
    );

    const responseQueueResult = await quietly(
        pubsub.projects.topics.get({
            topic: responseQueueTopic
        })
    );

    const subscriptionResult = await quietly(
        pubsub.projects.subscriptions.get({ subscription: responseSubscription })
    );

    return {
        functionResult,
        requestQueueResult,
        responseQueueResult,
        subscriptionResult
    };
}

export function checkResourcesCleanedUp<T extends object>(resources: T) {
    for (const key of keys(resources)) {
        expect(resources[key]).toBeUndefined();
    }
}

export function checkResourcesExist<T extends object>(resources: T) {
    expect(keys(resources).length).toBe(4);
    for (const key of keys(resources)) {
        expect(resources[key]).toBeTruthy();
    }
}

export interface RecordedCall<A, R> {
    args: A;
    rv: R;
}

export interface RecordedFunction<A extends any[], R> {
    (...any: A): R;
    recordings: Array<RecordedCall<A, R>>;
}

export function record<A extends any[], R>(fn: Fn<A, R>) {
    const func: RecordedFunction<A, R> = Object.assign(
        (...args: A) => {
            const rv = fn(...args);
            func.recordings.push({ args, rv });
            info(`func.recordings: %O`, func.recordings);
            return rv;
        },
        { recordings: [] }
    );
    return func;
}

export function contains<T extends U, U extends object>(container: T, obj: U) {
    for (const key of keys(obj)) {
        if (!(key in container) || container[key] !== obj[key]) {
            return false;
        }
    }
    logGc(`Contains: %O, %O`, container, obj);
    return true;
}
