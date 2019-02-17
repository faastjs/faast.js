import { Context, SNSEvent } from "aws-lambda";
import * as aws from "aws-sdk";
import { env } from "process";
import {
    CallingContext,
    createErrorResponse,
    FunctionCall,
    Wrapper,
    FunctionReturn
} from "../wrapper";
import { sendResponseQueueMessage } from "./aws-queue";
import { getExecutionLogUrl } from "./aws-shared";
import { ResponseMessage, Invocation } from "../provider";

const sqs = new aws.SQS({ apiVersion: "2012-11-05" });

export const filename = module.filename;

const CallIdAttribute: Extract<keyof Invocation, "callId"> = "callId";

export function makeTrampoline(wrapper: Wrapper) {
    async function trampoline(
        event: FunctionCall | SNSEvent,
        context: Context,
        callback: (err: Error | null, obj: FunctionReturn | string) => void
    ) {
        const startTime = Date.now();
        context.callbackWaitsForEmptyEventLoop = false;
        const executionId = context.awsRequestId;
        const { logGroupName, logStreamName } = context;
        const region = env.AWS_REGION!;
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
            const timeout = context.getRemainingTimeInMillis() - 50;
            const result = await wrapper.execute(
                { call, ...callingContext },
                metrics =>
                    sendResponseQueueMessage(sqs, Queue!, {
                        kind: "cpumetrics",
                        callId,
                        metrics
                    }),
                timeout
            );
            callback(null, result);
        } else {
            const snsEvent = event as SNSEvent;
            console.log(`SNS event: ${snsEvent.Records.length} records`);
            for (const record of snsEvent.Records) {
                const call = JSON.parse(record.Sns.Message) as FunctionCall;
                const { callId, ResponseQueueId: Queue } = call;
                const startedMessageTimer = setTimeout(
                    () =>
                        sendResponseQueueMessage(sqs, Queue!, {
                            kind: "functionstarted",
                            callId
                        }),
                    2 * 1000
                );
                const cc: CallingContext = { call, ...callingContext };
                const timeout = context.getRemainingTimeInMillis() - 50;
                const result = await wrapper.execute(
                    cc,
                    metrics =>
                        sendResponseQueueMessage(sqs, Queue!, {
                            kind: "cpumetrics",
                            callId,
                            metrics
                        }),
                    timeout
                );
                clearTimeout(startedMessageTimer);
                const response: ResponseMessage = {
                    kind: "response",
                    callId,
                    body: result
                };
                return sendResponseQueueMessage(sqs, Queue!, response).catch(err => {
                    console.error(err);
                    const errResponse: ResponseMessage = {
                        kind: "response",
                        callId,
                        body: createErrorResponse(err, cc)
                    };
                    sendResponseQueueMessage(sqs, Queue!, errResponse).catch(_ => {});
                });
            }
        }
    }
    return { trampoline };
}
