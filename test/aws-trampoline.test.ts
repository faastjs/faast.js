import test from "ava";
import { Context, SNSEvent } from "aws-lambda";
import { SQS } from "aws-sdk";
import * as uuidv4 from "uuid/v4";
import { AwsMetrics } from "../src/aws/aws-faast";
import { receiveMessages } from "../src/aws/aws-queue";
import { makeTrampoline } from "../src/aws/aws-trampoline";
import { Message } from "../src/provider";
import { deserialize, serialize, serializeFunctionArgs } from "../src/serialize";
import { Wrapper } from "../src/wrapper";
import * as funcs from "./fixtures/functions";
import { title } from "./fixtures/util";

const sqs = new SQS({ apiVersion: "2012-11-05", region: "us-west-2" });

const lambdaContext: Context = {
    callbackWaitsForEmptyEventLoop: true,
    awsRequestId: "aws-trampoline-test-awsRequestId",
    logGroupName: "aws-trampoline-test-logGroupName",
    logStreamName: "aws-trampoline-test-logStreamName",
    getRemainingTimeInMillis: () => 1000,
    functionName: "aws-trampoline-test-functionName",
    functionVersion: "aws-trampoline-test-functionVersion",
    invokedFunctionArn: "aws-trampoline-test-invokedFunctionArn",
    memoryLimitInMB: 1728,
    done: () => {},
    fail: _ => {},
    succeed: (_: string) => {}
};

test(title("aws", "trampoline https mode with promise response"), async t => {
    t.plan(1);
    process.env.AWS_REGION = "us-west-2";
    process.env.FAAST_SILENT = "true";
    const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
    const { trampoline } = makeTrampoline(wrapper);
    const arg = "promise with https on aws";
    const name = funcs.identityNum.name;
    await trampoline(
        {
            callId: "42",
            name,
            args: serializeFunctionArgs(name, [arg], true),
            modulePath: "./fixtures/functions"
        },
        lambdaContext,
        (_: Error | null, obj: Message[]) => {
            if (obj[0].kind === "promise") {
                const [ret] = deserialize(obj[0].value);
                t.is(ret, arg);
            }
        }
    );
});

test(title("aws", "trampoline queue mode with promise response"), async t => {
    t.plan(2);
    process.env.AWS_REGION = "us-west-2";
    process.env.FAAST_SILENT = "true";
    const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
    const QueueName = `faast-${uuidv4()}`;
    const { QueueUrl = "" } = await sqs.createQueue({ QueueName }).promise();
    const arg = "promise with queue on aws";

    try {
        const { trampoline } = makeTrampoline(wrapper);
        const name = funcs.identityNum.name;
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
        await trampoline(event as SNSEvent, lambdaContext, (_: any, _obj: any) => {});
        const metrics = new AwsMetrics();
        const cancel = new Promise<void>(_ => {});
        const result = await receiveMessages(sqs, QueueUrl, metrics, cancel);
        const msg = result.Messages[0];
        t.is(msg.kind, "promise");
        if (msg.kind === "promise") {
            const [ret] = deserialize(msg.value);
            t.is(ret, arg);
        }
    } finally {
        await sqs.deleteQueue({ QueueUrl }).promise();
    }
});

test(title("aws", "trampoline https mode with async iterator response"), async t => {
    t.plan(3);
    process.env.AWS_REGION = "us-west-2";
    process.env.FAAST_SILENT = "true";
    const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
    const { trampoline } = makeTrampoline(wrapper);
    const name = funcs.asyncGenerator.name;
    const arg = "async generator with https on aws";
    await trampoline(
        {
            callId: "44",
            name,
            args: serializeFunctionArgs(name, [arg], true),
            modulePath: "./fixtures/functions"
        },
        lambdaContext,
        (_: Error | null, obj: Message[]) => {
            const messages: any = [];
            obj.forEach(msg => {
                if (msg.kind === "iterator") {
                    const value = deserialize(msg.value)[0];
                    messages[msg.sequence] = value;
                }
            });
            t.is(messages.length, 2);
            t.deepEqual(messages[0], { done: false, value: arg });
            t.deepEqual(messages[1], { done: true });
        }
    );
});

test(title("aws", "trampoline queue mode with async iterator response"), async t => {
    process.env.AWS_REGION = "us-west-2";
    process.env.FAAST_SILENT = "true";
    const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
    const QueueName = `faast-${uuidv4()}`;
    const { QueueUrl = "" } = await sqs.createQueue({ QueueName }).promise();
    const arg = "async generator with queue on aws";

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
        await trampoline(event as SNSEvent, lambdaContext, (_: any, _obj: any) => {});
        const metrics = new AwsMetrics();
        const cancel = new Promise<void>(_ => {});
        const messages: any = [];
        let received = 0;
        while (received < 2) {
            const result = await receiveMessages(sqs, QueueUrl, metrics, cancel);
            result.Messages.forEach(msg => {
                if (msg.kind === "iterator") {
                    received++;
                    const value = deserialize(msg.value)[0];
                    messages[msg.sequence] = value;
                }
            });
        }
        t.is(messages.length, 2);
        t.deepEqual(messages[0], { done: false, value: arg });
        t.deepEqual(messages[1], { done: true });
    } finally {
        await sqs.deleteQueue({ QueueUrl }).promise();
    }
});
