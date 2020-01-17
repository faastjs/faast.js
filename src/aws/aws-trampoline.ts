import { Context, SNSEvent } from "aws-lambda";
import { SQS } from "aws-sdk";
import { env } from "process";
import { FaastError } from "../error";
import { Message } from "../provider";
import { deserialize } from "../serialize";
import { CallingContext, FunctionCall, Wrapper } from "../wrapper";
import { sendResponseQueueMessage } from "./aws-queue";
import { getExecutionLogUrl } from "./aws-shared";

const sqs = new SQS();

export const filename = module.filename;

const CallIdAttribute: Extract<keyof FunctionCall, "callId"> = "callId";

function errorCallback(err: Error) {
    if (err.message.match(/SIGKILL/)) {
        return new FaastError(err, "possibly out of memory");
    }
    return err;
}

export function makeTrampoline(wrapper: Wrapper) {
    async function trampoline(
        event: FunctionCall | SNSEvent,
        context: Context,
        callback: (err: Error | null, obj: Message[]) => void
    ) {
        const startTime = Date.now();
        const region = env.AWS_REGION!;
        sqs.config.region = region;
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
            const { callId, ResponseQueueId: Queue } = call;
            const results = [];
            for await (const result of wrapper.execute(
                { call, ...callingContext },
                {
                    onCpuUsage: metrics =>
                        sendResponseQueueMessage(sqs, Queue!, {
                            kind: "cpumetrics",
                            callId,
                            metrics
                        }),
                    errorCallback
                }
            )) {
                results.push(result);
            }
            callback(null, results);
        } else {
            const snsEvent = event as SNSEvent;
            for (const record of snsEvent.Records) {
                const call: FunctionCall = deserialize(record.Sns.Message);
                const { callId, ResponseQueueId: Queue } = call;
                let startedMessageTimer: NodeJS.Timeout | undefined = setTimeout(
                    () =>
                        sendResponseQueueMessage(sqs, Queue!, {
                            kind: "functionstarted",
                            callId
                        }),
                    2 * 1000
                );
                const cc: CallingContext = { call, ...callingContext };
                for await (const result of wrapper.execute(cc, {
                    onCpuUsage: metrics =>
                        sendResponseQueueMessage(sqs, Queue!, {
                            kind: "cpumetrics",
                            callId,
                            metrics
                        }),
                    errorCallback
                })) {
                    if (startedMessageTimer) {
                        clearTimeout(startedMessageTimer);
                        startedMessageTimer = undefined;
                    }
                    await sendResponseQueueMessage(sqs, Queue!, result);
                }
            }
        }
    }
    return { trampoline };
}
