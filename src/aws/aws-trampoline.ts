import { SNSEvent, Context } from "aws-lambda";
import * as aws from "aws-sdk";
import {
    FunctionCall,
    FunctionReturn,
    ModuleWrapper,
    createErrorResponse,
    CallingContext
} from "../trampoline";
import { publishSQS, publishSQSControlMessage } from "./aws-queue";
import { getExecutionUrl } from "./aws-shared";
import { env } from "process";

const awsSqs = new aws.SQS({ apiVersion: "2012-11-05" });

export const moduleWrapper = new ModuleWrapper();

export async function trampoline(
    event: FunctionCall | SNSEvent,
    context: Context,
    callback: (err: Error | null, obj: FunctionReturn | string) => void
) {
    const startTime = Date.now();
    const executionId = context.awsRequestId;
    const { logGroupName, logStreamName } = context;
    const region = env.AWS_REGION!;
    const logUrl = getExecutionUrl(region, logGroupName, logStreamName, executionId);
    const callingContext = {
        startTime,
        logUrl,
        executionId
    };
    if ("CallId" in event) {
        const call = event as FunctionCall;
        const result = await moduleWrapper.execute({ call, ...callingContext });
        callback(null, result);
    } else {
        const snsEvent = event as SNSEvent;
        console.log(`SNS event: ${snsEvent.Records.length} records`);
        for (const record of snsEvent.Records) {
            const call = JSON.parse(record.Sns.Message) as FunctionCall;
            const { CallId, ResponseQueueId } = call;
            const startedMessageTimer = setTimeout(
                () =>
                    publishSQSControlMessage(
                        "functionstarted",
                        awsSqs,
                        ResponseQueueId!,
                        {
                            CallId
                        }
                    ),
                2 * 1000
            );
            const result = await moduleWrapper.execute({ call, ...callingContext });
            clearTimeout(startedMessageTimer);
            return publishSQS(awsSqs, ResponseQueueId!, JSON.stringify(result), {
                CallId
            }).catch(puberr => {
                console.error(puberr);
                sendError(puberr, ResponseQueueId!, { call, ...callingContext });
            });
        }
    }
}

function ignore(p: Promise<any>) {
    return p.catch(_ => {});
}

async function sendError(
    err: any,
    ResponseQueueUrl: string,
    callingContext: CallingContext
) {
    console.error(err);
    const errorResponse = {
        QueueUrl: ResponseQueueUrl,
        MessageBody: JSON.stringify(createErrorResponse(err, callingContext))
    };
    return ignore(
        publishSQS(awsSqs, ResponseQueueUrl, JSON.stringify(errorResponse), {
            CallId: callingContext.call.CallId
        })
    );
}
