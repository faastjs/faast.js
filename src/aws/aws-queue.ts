import { SNSEvent } from "aws-lambda";
import { SNS, SQS } from "aws-sdk";
import { FaastError, FaastErrorNames } from "../error";
import { log } from "../log";
import { Message, PollResult } from "../provider";
import { deserialize, serialize } from "../serialize";
import { computeHttpResponseBytes, defined, sum } from "../shared";
import { retryOp } from "../throttle";
import { createErrorResponse, FunctionCall } from "../wrapper";
import { AwsMetrics } from "./aws-faast";

export async function createSNSTopic(sns: SNS, Name: string) {
    const topic = await sns.createTopic({ Name }).promise();
    return topic.TopicArn!;
}

function countRequests(bytes: number) {
    return Math.ceil(bytes / (64 * 1024));
}

export async function sendResponseQueueMessage(
    sqs: SQS,
    QueueUrl: string,
    message: Message
) {
    try {
        const request = { QueueUrl, MessageBody: serialize(message) };
        await sqs.sendMessage(request).promise();
    } catch (err: any) {
        log.warn(err);
    }
}

export function publishFunctionCallMessage(
    sns: SNS,
    TopicArn: string,
    message: FunctionCall,
    metrics: AwsMetrics
) {
    const serialized = serialize(message);
    metrics.sns64kRequests += countRequests(serialized.length);
    return retryOp(
        (err, n) => n < 6 && err?.message?.match(/does not exist/),
        () =>
            sns
                .publish({
                    TopicArn,
                    Message: serialized
                })
                .promise()
    );
}

export async function createSQSQueue(QueueName: string, VTimeout: number, sqs: SQS) {
    try {
        const createQueueRequest: SQS.CreateQueueRequest = {
            QueueName,
            Attributes: {
                VisibilityTimeout: `${VTimeout}`
            }
        };
        const response = await sqs.createQueue(createQueueRequest).promise();
        const QueueUrl = response.QueueUrl!;
        const arnResponse = await sqs
            .getQueueAttributes({ QueueUrl, AttributeNames: ["QueueArn"] })
            .promise();
        const QueueArn = arnResponse.Attributes?.QueueArn;
        return { QueueUrl, QueueArn };
    } catch (err: any) {
        throw new FaastError(err, "create sqs queue");
    }
}

/* c8 ignore next  */
export function processAwsErrorMessage(message: string): Error {
    let err = new FaastError(message);
    if (
        message?.match(/Process exited before completing/) ||
        message?.match(/signal: killed/)
    ) {
        err = new FaastError(
            { cause: err, name: FaastErrorNames.EMEMORY },
            "possibly out of memory"
        );
    } else if (message?.match(/time/)) {
        err = new FaastError({ cause: err, name: FaastErrorNames.ETIMEOUT }, "timeout");
    } else if (message?.match(/EventAgeExceeded/)) {
        err = new FaastError(
            { cause: err, name: FaastErrorNames.ECONCURRENCY },
            "concurrency limit exceeded"
        );
    }
    return err;
}

export async function receiveMessages(
    sqs: SQS,
    ResponseQueueUrl: string,
    metrics: AwsMetrics,
    cancel: Promise<void>
): Promise<PollResult> {
    try {
        const MaxNumberOfMessages = 10;
        const request = sqs.receiveMessage({
            QueueUrl: ResponseQueueUrl!,
            WaitTimeSeconds: 20,
            MaxNumberOfMessages,
            MessageAttributeNames: ["All"],
            AttributeNames: ["SentTimestamp"]
        });

        const response = await Promise.race([request.promise(), cancel]);
        if (!response) {
            request.abort();
            return { Messages: [] };
        }

        const { Messages = [] } = response;
        const { httpResponse } = response.$response;
        const receivedBytes = computeHttpResponseBytes(httpResponse.headers);
        metrics.outboundBytes += receivedBytes;
        const inferredSqsRequestsReceived = countRequests(receivedBytes);
        const inferredSqsRequestsSent = sum(
            Messages.map(m => countRequests(m.Body?.length ?? 1))
        );
        metrics.sqs64kRequests += inferredSqsRequestsSent + inferredSqsRequestsReceived;
        if (Messages.length > 0) {
            sqs.deleteMessageBatch({
                QueueUrl: ResponseQueueUrl!,
                Entries: Messages.map(m => ({
                    Id: m.MessageId!,
                    ReceiptHandle: m.ReceiptHandle!
                }))
            })
                .promise()
                .catch(_ => {});
            metrics.sqs64kRequests++;
        }
        return {
            Messages: Messages.map(processIncomingQueueMessage).filter(defined),
            isFullMessageBatch: Messages.length === MaxNumberOfMessages
        };
    } catch (err: any) {
        throw new FaastError(err, "receiveMessages");
    }
}

interface LambdaDestinationError {
    errorMessage: string;
    errorType?: string;
    stackTrace?: string[];
}

interface LambdaDestinationMessage {
    version: string;
    timestamp: string;
    requestContext: {
        requestId: string;
        functionArn: string;
        condition: "RetriesExhausted" | "Success";
        approximateInvokeCount: number;
    };
    requestPayload: object;
    responseContext: {
        statusCode: number;
        executedVersion: string;
        functionError?: string;
    };
    responsePayload: LambdaDestinationError | object;
}

function processIncomingQueueMessage(m: SQS.Message): Message | void {
    // AWS Lambda Destinations
    // (https://aws.amazon.com/blogs/compute/introducing-aws-lambda-destinations/)
    // are used to route failures to the response queue. These
    // messages are generated by AWS Lambda and are constrained to the format it
    // provides.
    const raw = deserialize(m.Body!);
    if (raw.responseContext) {
        const message = raw as LambdaDestinationMessage;
        const snsMessage = message.requestPayload as SNSEvent;
        const record = snsMessage.Records[0];
        const sCall: FunctionCall = deserialize(record.Sns.Message);
        let error: Error | undefined;
        const destinationError = message.responsePayload as LambdaDestinationError;
        if (destinationError) {
            error = processAwsErrorMessage(destinationError.errorMessage);
            error.stack = destinationError.stackTrace?.join("\n");
        } else {
            error = processAwsErrorMessage(message.requestContext.condition);
        }
        const executionId = message.requestContext.requestId;
        return {
            ...createErrorResponse(error, {
                call: sCall,
                startTime: new Date(record.Sns.Timestamp).getTime(),
                executionId
            }),
            timestamp: new Date(message.timestamp).getTime()
        };
    } else {
        const message = raw as Message;
        switch (message.kind) {
            case "promise":
            case "iterator":
                message.timestamp = Number(m.Attributes!.SentTimestamp);
                break;
            case "cpumetrics":
                break;
            case "functionstarted":
                break;
            default: {
                console.warn(`Unknown message received from response queue`);
            }
        }
        return raw;
    }
}
