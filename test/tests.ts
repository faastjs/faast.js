import test, { ExecutionContext } from "ava";
import * as awsFaast from "../src/aws/aws-faast";
import * as faast from "../src/faast";
import { faastify } from "../src/faast";
import { info, logGc, stats, warn } from "../src/log";
import { CommonOptions } from "../src/provider";
import { keys, sleep, Statistics } from "../src/shared";
import { Pump } from "../src/throttle";
import {
    detectAsyncLeaks,
    startAsyncTracing,
    stopAsyncTracing,
    clearLeakDetector
} from "../src/trace";
import { Fn } from "../src/types";
import * as funcs from "./functions";
import { inspect } from "util";

export function testFunctions(provider: "aws", options: awsFaast.Options): void;
export function testFunctions(provider: "local", options: faast.local.Options): void;
export function testFunctions(provider: faast.Provider, options: CommonOptions): void;
export function testFunctions(provider: faast.Provider, options: CommonOptions): void {
    let cloudFunc: faast.CloudFunction<typeof funcs>;
    let remote: faast.Promisified<typeof funcs>;
    const opts = inspect(options, { breakLength: Infinity });
    let initialized = false;

    async function init() {
        try {
            if (initialized) {
                return;
            }
            initialized = true;
            const start = Date.now();
            const opts = { timeout: 30, memorySize: 512, gc: false, ...options };
            cloudFunc = await faastify(provider, funcs, "./functions", opts);
            remote = cloudFunc.functions;
            info(`Function creation took ${((Date.now() - start) / 1000).toFixed(1)}s`);
        } catch (err) {
            warn(err);
        }
    }

    test.after.always(() => cloudFunc && cloudFunc.cleanup());

    test(`${provider} ${opts} hello: string => string`, async t => {
        await init();
        t.is(await remote.hello("Andy"), "Hello Andy!");
    });

    test(`${provider} ${opts} multibyte characters in arguments and return value`, async t => {
        await init();
        t.is(await remote.identity("你好"), "你好");
    });

    test(`${provider} ${opts} fact: number => number`, async t => {
        await init();
        t.is(await remote.fact(5), 120);
    });

    test(`${provider} ${opts} concat: (string, string) => string`, async t => {
        await init();
        t.is(await remote.concat("abc", "def"), "abcdef");
    });

    test(`${provider} ${opts} error: string => raise exception`, async t => {
        await init();
        await t.throwsAsync(remote.error("hey"), "Expected this error. Argument: hey");
    });

    test(`${provider} ${opts} noargs: () => string`, async t => {
        await init();
        t.is(await remote.noargs(), "successfully called function with no args.");
    });

    test(`${provider} ${opts} async: () => Promise<string>`, async t => {
        await init();
        t.is(await remote.async(), "returned successfully from async function");
    });

    test(`${provider} ${opts} path: () => Promise<string>`, async t => {
        await init();
        t.is(typeof (await remote.path()), "string");
    });

    test(`${provider} ${opts} rejected: () => rejected promise`, async t => {
        await init();
        await t.throwsAsync(remote.rejected(), "This promise is intentionally rejected.");
    });

    test(`${provider} ${opts} empty promise rejection`, async t => {
        await init();
        await t.throwsAsync(remote.emptyReject());
    });

    test(`${provider} ${opts} promise args not supported`, async t => {
        await init();
        await t.throwsAsync(remote.promiseArg(Promise.resolve("hello")));
    });

    test(`${provider} ${opts} optional arguments are supported`, async t => {
        await init();
        t.is(await remote.optionalArg(), "No arg");
        t.is(await remote.optionalArg("has arg"), "has arg");
    });
}

export function testCosts(provider: faast.Provider, options: CommonOptions = {}) {
    let cloudFunc: faast.CloudFunction<typeof funcs>;
    const opts = inspect(options, { breakLength: Infinity });
    let initialized = false;

    async function init() {
        if (initialized) {
            return;
        }
        initialized = true;
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
    }

    test.after.always(() => cloudFunc && cloudFunc.cleanup());

    test(`${provider} ${opts} cost for basic call`, async t => {
        await init();
        await cloudFunc.functions.hello("there");
        const costs = await cloudFunc.costEstimate();
        info(`${costs}`);
        info(`CSV costs:\n${costs.csv()}`);

        const { estimatedBilledTime } = cloudFunc.stats.aggregate;
        t.is(
            (estimatedBilledTime.mean * estimatedBilledTime.samples) / 1000,
            costs.metrics.find(m => m.name === "functionCallDuration")!.measured
        );

        t.true(costs.metrics.length > 1);
        t.true(costs.find("functionCallRequests")!.measured === 1);
        for (const metric of costs.metrics) {
            if (!metric.alwaysZero) {
                t.true(metric.cost() > 0);
                t.true(metric.measured > 0);
                t.true(metric.pricing > 0);
            }

            t.true(metric.cost() < 0.00001);
            t.true(metric.name.length > 0);
            t.true(metric.unit.length > 0);
            t.true(metric.cost() === metric.pricing * metric.measured);
        }
        t.true(costs.total() > 0);
    });
}

export function testRampUp(
    provider: faast.Provider,
    concurrency: number,
    options?: CommonOptions
) {
    const opts = inspect(options, { breakLength: Infinity });
    let lambda: faast.CloudFunction<typeof funcs>;
    let initialized = false;
    async function init() {
        try {
            if (initialized) {
                return;
            }
            initialized = true;
            lambda = await faastify(provider, funcs, "./functions", {
                gc: false,
                ...options,
                concurrency
            });
            lambda.on("stats", s => stats.log(s.toString()));
        } catch (err) {
            warn(err);
        }
    }

    test.after.always(() => lambda && lambda.cleanup());

    test(`${provider} ${opts} Monte Carlo estimate of PI using 1B samples and 500 invocations`, async t => {
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
    });
}

export function testThroughput(
    provider: faast.Provider,
    duration: number,
    concurrency: number = 500,
    options?: CommonOptions
) {
    const opts = inspect(options, { breakLength: Infinity });
    let lambda: faast.CloudFunction<typeof funcs>;
    let initialized = false;

    async function init() {
        try {
            if (!initialized) {
                return;
            }
            initialized = true;
            lambda = await faastify(provider, funcs, "./functions", {
                gc: false,
                ...options
            });
            lambda.on("stats", s => stats.log(s.toString()));
        } catch (err) {
            warn(err);
        }
    }

    test.after.always(() => lambda && lambda.cleanup());
    // test.after.always(() => lambda.cancelAll(), 30 * 1000);

    test(`${provider} ${opts} sustained load test`, async () => {
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

export function testTimeout(provider: faast.Provider, options?: CommonOptions) {
    let lambda: faast.CloudFunction<typeof funcs>;
    const opts = inspect(options, { breakLength: Infinity });
    let initialized = false;

    async function init() {
        try {
            if (initialized) {
                return;
            }
            initialized = true;
            lambda = await faastify(provider, funcs, "./functions", {
                ...options,
                timeout: 2,
                maxRetries: 0,
                gc: false
            });
        } catch (err) {
            warn(err);
        }
    }

    test.after.always(() => lambda && lambda.cleanup());

    test(`${provider} ${opts} timeout error`, async t => {
        await init();
        await t.throwsAsync(lambda.functions.sleep(4 * 1000), /time/i);
    });
}

export function testMemoryLimit(provider: faast.Provider, options?: CommonOptions) {
    const opts = inspect(options, { breakLength: Infinity });
    let lambda: faast.CloudFunction<typeof funcs>;
    let initialized = false;

    async function init() {
        try {
            if (initialized) {
                return;
            }
            initialized = true;
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
    }

    test.after.always(() => lambda && lambda.cleanup());

    test(`${provider} ${opts} can allocate under memory limit`, async t => {
        await init();
        const bytes = 64 * 1024 * 1024;
        const rv = await lambda.functions.allocate(bytes);
        t.is(rv.elems, bytes / 8);
    });

    test(`${provider} ${opts} out of memory error`, async t => {
        await init();
        const bytes = 512 * 1024 * 1024;
        await t.throwsAsync(lambda.functions.allocate(bytes), /memory/i);
    });
}

export function testCpuMetrics(provider: faast.Provider, options?: CommonOptions) {
    const opts = inspect(options, { breakLength: Infinity });
    let lambda: faast.CloudFunction<typeof funcs>;
    let initialized = false;

    async function init() {
        if (initialized) {
            return;
        }
        initialized = true;
        lambda = await faastify(provider, funcs, "./functions", {
            childProcess: true,
            timeout: 30,
            memorySize: 512,
            maxRetries: 0,
            gc: false,
            ...options
        });
    }

    test.after.always(() => lambda && lambda.cleanup());

    test(`${provider} ${opts} cpu metrics are received`, async t => {
        await init();
        const N = 5;
        const NSec = 5;
        const promises: Promise<unknown>[] = [];
        for (let i = 0; i < N; i++) {
            promises.push(lambda.functions.spin(NSec * 1000));
        }
        await Promise.all(promises);
        const usage = lambda.cpuUsage.get("spin");
        t.truthy(usage);
        t.true(usage!.size > 0);
        t.true(usage!.get(1)!.stime instanceof Statistics);
        t.true(usage!.get(1)!.utime instanceof Statistics);
    });
}

export function testCancellation(provider: faast.Provider, options?: CommonOptions) {
    const opts = inspect(options, { breakLength: Infinity });
    test.serial(
        `${provider} ${opts} cleanup waits for all child processes to exit`,
        async t => {
            await sleep(0); // wait until jest sets its timeout so it doesn't get picked up by async_hooks.
            startAsyncTracing();
            const cloudFunc = await faastify(provider, funcs, "./functions", {
                ...options,
                childProcess: true,
                gc: false
            });
            cloudFunc.functions.spin(10000).catch(_ => {});
            await sleep(500); // wait until the request actually starts
            await cloudFunc.cleanup();
            stopAsyncTracing();
            await sleep(500);
            const leaks = detectAsyncLeaks();
            t.true(leaks.length === 0);
            clearLeakDetector();
        }
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

export function checkResourcesCleanedUp<T extends object>(
    t: ExecutionContext,
    resources: T
) {
    for (const key of keys(resources)) {
        t.true(resources[key] === undefined);
    }
}

export function checkResourcesExist<T extends object>(t: ExecutionContext, resources: T) {
    t.true(keys(resources).length === 4);
    for (const key of keys(resources)) {
        t.truthy(resources[key]);
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
