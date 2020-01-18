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

const sqs = new SQS({ region: "us-west-2" });

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

test(title("aws", "trampoline https mode"), async t => {
    t.plan(1);
    process.env.AWS_REGION = "us-west-2";
    process.env.FAAST_SILENT = "true";
    const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
    const { trampoline } = makeTrampoline(wrapper);
    const arg = "abc123";
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
            if (obj[0].kind === "response") {
                const [ret] = deserialize(obj[0].value);
                t.is(ret, arg);
            }
        }
    );
});

test(title("aws", "trampoline queue mode"), async t => {
    t.plan(2);
    process.env.AWS_REGION = "us-west-2";
    process.env.FAAST_SILENT = "true";
    const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
    const QueueName = `faast-${uuidv4()}`;
    const { QueueUrl = "" } = await sqs.createQueue({ QueueName }).promise();
    const arg = "987zyx";

    try {
        const { trampoline } = makeTrampoline(wrapper);
        const name = funcs.identityNum.name;
        const call = {
            callId: "42",
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
        t.is(msg.kind, "response");
        if (msg.kind === "response") {
            const [ret] = deserialize(msg.value);
            t.is(ret, arg);
        }
    } finally {
        await sqs.deleteQueue({ QueueUrl }).promise();
    }
});
