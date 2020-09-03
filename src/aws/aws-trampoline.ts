import { Context, SNSEvent } from "aws-lambda";
import { SQS } from "aws-sdk";
import { env } from "process";
import { FaastError, FaastErrorNames } from "../error";
import { deserialize } from "../serialize";
import { CallingContext, FunctionCall, Wrapper } from "../wrapper";
import { sendResponseQueueMessage } from "./aws-queue";
import { getExecutionLogUrl } from "./aws-shared";

export const filename = module.filename;

export const INVOCATION_TEST_QUEUE = "*test*";

const CallIdAttribute: Extract<keyof FunctionCall, "callId"> = "callId";

function errorCallback(err: Error) {
    if (err.message.match(/SIGKILL/)) {
        return new FaastError(
            { cause: err, name: FaastErrorNames.EMEMORY },
            "possibly out of memory"
        );
    }
    return err;
}

export function makeTrampoline(wrapper: Wrapper) {
    async function trampoline(event: FunctionCall | SNSEvent, context: Context) {
        const startTime = Date.now();
        const region = env.AWS_REGION!;
        context.callbackWaitsForEmptyEventLoop = false;
        const executionId = context.awsRequestId;
        const { logGroupName, logStreamName } = context;
        const logUrl = getExecutionLogUrl(
            region,
            logGroupName,
            logStreamName,
            executionId
        );
        const callingContext = {
            startTime,
            logUrl,
            executionId,
            instanceId: logStreamName
        };
        if (CallIdAttribute in event) {
            const call = event as FunctionCall;
            const cc: CallingContext = { call, ...callingContext };
            await execute(cc, wrapper);
        } else {
            const snsEvent = event as SNSEvent;
            for (const record of snsEvent.Records) {
                const call: FunctionCall = deserialize(record.Sns.Message);
                const cc: CallingContext = { call, ...callingContext };
                await execute(cc, wrapper);
            }
        }
    }
    return { trampoline };
}

async function execute(cc: CallingContext, wrapper: Wrapper) {
    const { call } = cc;
    const { ResponseQueueId: Queue } = call;
    if (Queue === INVOCATION_TEST_QUEUE) {
        return;
    }
    const region = env.AWS_REGION!;
    const sqs = new SQS({ apiVersion: "2012-11-05", maxRetries: 6, region });
    await wrapper.execute(cc, {
        errorCallback,
        onMessage: msg => sendResponseQueueMessage(sqs, Queue!, msg)
    });
}
