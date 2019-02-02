import test, { ExecutionContext } from "ava";
import { inspect } from "util";
import * as awsFaast from "../src/aws/aws-faast";
import * as faast from "../src/faast";
import { faastify } from "../src/faast";
import { info, logGc, stats, warn } from "../src/log";
import { CommonOptions } from "../src/provider";
import { keys, sleep } from "../src/shared";
import { Pump } from "../src/throttle";
import { Fn } from "../src/types";
import * as funcs from "./functions";
import { macros, once } from "./util";

export function testFunctions(provider: "aws", options: awsFaast.Options): void;
export function testFunctions(provider: "local", options: faast.local.Options): void;
export function testFunctions(provider: faast.Provider, options: CommonOptions): void;
export function testFunctions(provider: faast.Provider, options: CommonOptions): void {
    let cloudFunc: faast.CloudFunction<typeof funcs>;
    let remote: faast.Promisified<typeof funcs>;
    const opts = inspect(options, { breakLength: Infinity });

    const init = async () => {
        try {
            const start = Date.now();
            const opts = { timeout: 30, memorySize: 512, gc: false, ...options };
            cloudFunc = await faastify(provider, funcs, "./functions", opts);
            remote = cloudFunc.functions;
            info(`Function creation took ${((Date.now() - start) / 1000).toFixed(1)}s`);
        } catch (err) {
            warn(err);
        }
    };
    const cleanup = () => cloudFunc && cloudFunc.cleanup();
    const title = (name?: string) => `${provider} ${name} ${opts}`;
    const { eq, reject, rejectError } = macros(init, title, cleanup);

    test(`hello`, eq, () => remote.hello("Andy"), "Hello Andy!");
    test(`multibyte characters`, eq, () => remote.identity("你好"), "你好");
    test(`factorial`, eq, () => remote.fact(5), 120);
    test(`concat`, eq, () => remote.concat("abc", "def"), "abcdef");
    test(`exception`, rejectError, () => remote.error("hey"), "Expected error. Arg: hey");
    test(`no arguments`, eq, () => remote.noargs(), "called function with no args.");
    test(`async function`, eq, () => remote.async(), "async function: success");
    test(`get $PATH`, eq, async () => typeof (await remote.path()), "string");
    test(`optional arg absent`, eq, () => remote.optionalArg(), "No arg");
    test(`optional arg present`, eq, () => remote.optionalArg("has arg"), "has arg");
    test(`empty promise rejection`, reject, () => remote.emptyReject(), undefined);
    test(`rejected promise`, reject, () => remote.rejected(), "intentionally rejected");

    const p = Promise.resolve();
    test(`no promise args`, rejectError, () => remote.promiseArg(p), /not supported/);
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
            lambda = await faastify(provider, funcs, "./functions", {
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

    const init = once(async () => {
        try {
            lambda = await faastify(provider, funcs, "./functions", {
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
