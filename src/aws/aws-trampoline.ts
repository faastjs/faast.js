import { Context, SNSEvent } from "aws-lambda";
import * as aws from "aws-sdk";
import { env } from "process";
import {
    CallingContext,
    createErrorResponse,
    FunctionCall,
    Wrapper,
    FunctionReturn,
    serializeReturn
} from "../wrapper";
import { publishResponseMessage } from "./aws-queue";
import { getExecutionLogUrl } from "./aws-shared";
import { ResponseMessage } from "../provider";

const awsSqs = new aws.SQS({ apiVersion: "2012-11-05" });

export const filename = module.filename;

export function makeTrampoline(wrapper: Wrapper) {
    async function trampoline(
        event: FunctionCall | SNSEvent,
        context: Context,
        callback: (err: Error | null, obj: FunctionReturn | string) => void
    ) {
        context.callbackWaitsForEmptyEventLoop = false;
        const startTime = Date.now();
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
        if ("CallId" in event) {
            const call = event as FunctionCall;
            const result = await wrapper.execute({ call, ...callingContext });
            callback(null, result);
        } else {
            const snsEvent = event as SNSEvent;
            console.log(`SNS event: ${snsEvent.Records.length} records`);
            for (const record of snsEvent.Records) {
                const call = JSON.parse(record.Sns.Message) as FunctionCall;
                const { CallId, ResponseQueueId: Queue } = call;
                const startedMessageTimer = setTimeout(
                    () =>
                        publishResponseMessage(awsSqs, Queue!, {
                            kind: "functionstarted",
                            CallId
                        }),
                    2 * 1000
                );
                const cc: CallingContext = { call, ...callingContext };
                const result = await wrapper.execute(cc);
                clearTimeout(startedMessageTimer);
                const response: ResponseMessage = {
                    kind: "response",
                    CallId,
                    body: result
                };
                return publishResponseMessage(awsSqs, Queue!, response).catch(err => {
                    console.error(err);
                    const errResponse: ResponseMessage = {
                        kind: "response",
                        CallId,
                        body: createErrorResponse(err, cc)
                    };
                    publishResponseMessage(awsSqs, Queue!, errResponse).catch(_ => {});
                });
            }
        }
    }
    return { trampoline };
}
