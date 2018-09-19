import { SNSEvent } from "aws-lambda";
import * as aws from "aws-sdk";
import { FunctionCall, FunctionReturn, ModuleWrapper } from "../trampoline";
import { publishSQS, publishSQSControlMessage } from "./aws-queue";

const awsSqs = new aws.SQS({ apiVersion: "2012-11-05" });

export const moduleWrapper = new ModuleWrapper();

export async function trampoline(
    event: FunctionCall | SNSEvent,
    _context: any,
    callback: (err: Error | null, obj: FunctionReturn | string) => void
) {
    const start = Date.now();
    if ("CallId" in event) {
        const call = event as FunctionCall;
        const result = await moduleWrapper.execute(call, start);
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
            const result = await moduleWrapper.execute(call, start);
            clearTimeout(startedMessageTimer);
            return publishSQS(awsSqs, ResponseQueueId!, JSON.stringify(result), {
                CallId
            }).catch(puberr => {
                sendError(
                    puberr,
                    ResponseQueueId!,
                    call,
                    result.remoteExecutionStartTime!
                );
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
    call: FunctionCall,
    start: number
) {
    console.error(err);

    const errorResponse = {
        QueueUrl: ResponseQueueUrl,
        MessageBody: JSON.stringify(moduleWrapper.createErrorResponse(err, call, start))
    };
    return ignore(
        publishSQS(awsSqs, ResponseQueueUrl, JSON.stringify(errorResponse), {
            CallId: call.CallId
        })
    );
}
