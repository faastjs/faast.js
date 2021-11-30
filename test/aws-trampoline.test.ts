/**
 * The purpose of this test is to check that the trampoline function on AWS can
 * route calls, invoke the wrapper, and return values correctly, without
 * actually creating a cloud function. However, it does use real cloud queues.
 */
import test from "ava";
import { Context, SNSEvent } from "aws-lambda";
import { SQS } from "aws-sdk";
import { v4 as uuidv4 } from "uuid";
import { AwsMetrics } from "../src/aws/aws-faast";
import { receiveMessages } from "../src/aws/aws-queue";
import { makeTrampoline } from "../src/aws/aws-trampoline";
import { filterMessages, Kind } from "../src/provider";
import { serialize, serializeFunctionArgs } from "../src/serialize";
import { sleep } from "../src/shared";
import { Wrapper } from "../src/wrapper";
import * as funcs from "./fixtures/functions";
import { checkIteratorMessages, expectMessage, title } from "./fixtures/util";

const sqs = new SQS({ apiVersion: "2012-11-05", region: "us-west-2" });
process.env.AWS_REGION = "us-west-2";
process.env.FAAST_SILENT = "true";

const lambdaContext: Context = {
    callbackWaitsForEmptyEventLoop: true,
    awsRequestId: "aws-trampoline-test-awsRequestId",
    logGroupName: "aws-trampoline-test-logGroupName",
    logStreamName: "aws-trampoline-test-logStreamName",
    getRemainingTimeInMillis: () => 1000,
    functionName: "aws-trampoline-test-functionName",
    functionVersion: "aws-trampoline-test-functionVersion",
    invokedFunctionArn: "aws-trampoline-test-invokedFunctionArn",
    memoryLimitInMB: "1728",
    done: () => {},
    fail: _ => {},
    succeed: (_: string) => {}
};

async function makeResponseQueue() {
    const QueueName = `faast-${uuidv4()}-test`;
    const { QueueUrl } = await sqs.createQueue({ QueueName }).promise();
    return QueueUrl!;
}

async function deleteResponseQueue(QueueUrl: string) {
    try {
        // Sometimes AWS needs time to propagate the existence of a queue before
        // deleting it. This manifests as a NonExistentQueue error. Waiting
        // a short while seems to make this less common.
        await sleep(5000);
        return await sqs.deleteQueue({ QueueUrl }).promise();
    } catch (err: any) {
        console.error(`Could not delete response queue: ${err}`);
        throw err;
    }
}

async function getMessages<K extends Kind>(QueueUrl: string, kind: K, nExpected: number) {
    const metrics = new AwsMetrics();
    const cancel = new Promise<void>(_ => {});
    const result = [];
    while (result.length < nExpected) {
        const messages = await receiveMessages(sqs, QueueUrl, metrics, cancel);
        result.push(...filterMessages(messages.Messages, kind));
    }
    return result;
}

test(title("aws", "trampoline https mode with promise response"), async t => {
    const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
    const { trampoline } = makeTrampoline(wrapper);
    const arg = "promise with https on aws";
    const name = funcs.identityString.name;
    const QueueUrl = await makeResponseQueue();
    try {
        await trampoline(
            {
                callId: "42",
                name,
                args: serializeFunctionArgs(name, [arg], true),
                modulePath: "./fixtures/functions",
                ResponseQueueId: QueueUrl
            },
            lambdaContext
        );

        const [msg] = await getMessages(QueueUrl, "promise", 1);
        expectMessage(t, msg, "promise", arg);
    } finally {
        deleteResponseQueue(QueueUrl);
    }
});

test(title("aws", "trampoline queue mode with promise response"), async t => {
    const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
    const arg = "promise with queue on aws";
    const QueueUrl = await makeResponseQueue();
    try {
        const { trampoline } = makeTrampoline(wrapper);
        const name = funcs.identityString.name;
        const call = {
            callId: "43",
            name,
            args: serializeFunctionArgs(name, [arg], true),
            modulePath: "./fixtures/functions",
            ResponseQueueId: QueueUrl
        };
        const event = {
            Records: [
                {
                    Sns: {
                        Message: serialize(call)
                    }
                }
            ]
        };

        await trampoline(event as SNSEvent, lambdaContext);

        const [msg] = await getMessages(QueueUrl, "promise", 1);
        expectMessage(t, msg, "promise", arg);
    } finally {
        await deleteResponseQueue(QueueUrl);
    }
});

test(title("aws", "trampoline https mode with async iterator response"), async t => {
    const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
    const { trampoline } = makeTrampoline(wrapper);
    const name = funcs.asyncGenerator.name;
    const arg = ["async generator with https on aws", "second arg"];
    const QueueUrl = await makeResponseQueue();
    try {
        await trampoline(
            {
                callId: "44",
                name,
                args: serializeFunctionArgs(name, [arg], true),
                modulePath: "./fixtures/functions",
                ResponseQueueId: QueueUrl
            },
            lambdaContext
        );
        const messages = await getMessages(QueueUrl, "iterator", arg.length + 1);
        checkIteratorMessages(t, messages, arg);
    } finally {
        await deleteResponseQueue(QueueUrl);
    }
});

test(title("aws", "trampoline queue mode with async iterator response"), async t => {
    const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
    const QueueUrl = await makeResponseQueue();
    const arg = ["async generator with queue on aws", "second arg"];

    try {
        const { trampoline } = makeTrampoline(wrapper);
        const name = funcs.asyncGenerator.name;
        const call = {
            callId: "45",
            name,
            args: serializeFunctionArgs(name, [arg], true),
            modulePath: "./fixtures/functions",
            ResponseQueueId: QueueUrl
        };
        const event = {
            Records: [
                {
                    Sns: {
                        Message: serialize(call)
                    }
                }
            ]
        };

        await trampoline(event as SNSEvent, lambdaContext);

        const messages = await getMessages(QueueUrl, "iterator", arg.length + 1);
        checkIteratorMessages(t, messages, arg);
    } finally {
        await deleteResponseQueue(QueueUrl);
    }
});
