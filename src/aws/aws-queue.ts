import { AbortController } from "@aws-sdk/abort-controller";
import { SNS } from "@aws-sdk/client-sns";
import { CreateQueueRequest, Message as SQSMessage, SQS } from "@aws-sdk/client-sqs";
import { SNSEvent } from "aws-lambda/trigger/sns";
import { FaastError, FaastErrorNames } from "../error";
import { log } from "../log";
import { Message, PollResult } from "../provider";
import { deserialize, serialize } from "../serialize";
import { computeHttpResponseBytes, defined, sum } from "../shared";
import { retryOp } from "../throttle";
import { createErrorResponse, FunctionCall } from "../wrapper";
import { AwsMetrics } from "./aws-faast";

export async function createSNSTopic(sns: SNS, Name: string) {
    const topic = await sns.createTopic({ Name });
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
        await sqs.sendMessage(request);
    } catch (err) {
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
        () => sns.publish({ TopicArn, Message: serialized })
    );
}

export async function createSQSQueue(QueueName: string, VTimeout: number, sqs: SQS) {
    try {
        const createQueueRequest: CreateQueueRequest = {
            QueueName,
            Attributes: {
                VisibilityTimeout: `${VTimeout}`
            }
        };
        const response = await sqs.createQueue(createQueueRequest);
        const QueueUrl = response.QueueUrl!;
        const arnResponse = await sqs.getQueueAttributes({
            QueueUrl,
            AttributeNames: ["QueueArn"]
        });
        const QueueArn = arnResponse.Attributes?.QueueArn;
        return { QueueUrl, QueueArn };
    } catch (err) {
        throw new FaastError(err, "create sqs queue");
    }
}

/* istanbul ignore next  */
export function processAwsErrorMessage(message?: string): Error {
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
        const abortController = new AbortController();
        const request = sqs.receiveMessage(
            {
                QueueUrl: ResponseQueueUrl!,
                WaitTimeSeconds: 20,
                MaxNumberOfMessages,
                MessageAttributeNames: ["All"],
                AttributeNames: ["SentTimestamp"]
            },
            { abortSignal: abortController.signal }
        );
        const response = await Promise.race([request, cancel]);
        if (!response) {
            abortController.abort();
            return { Messages: [] };
        }

        const { Messages = [] } = response;
        // XXX
        // const { httpResponse } = response.$response;
        // const receivedBytes = computeHttpResponseBytes(httpResponse.headers);
        // metrics.outboundBytes += receivedBytes;
        // const inferredSqsRequestsReceived = countRequests(receivedBytes);
        // const inferredSqsRequestsSent = sum(
        //     Messages.map(m => countRequests(m.Body?.length ?? 1))
        // );
        // metrics.sqs64kRequests += inferredSqsRequestsSent + inferredSqsRequestsReceived;
        if (Messages.length > 0) {
            sqs.deleteMessageBatch({
                QueueUrl: ResponseQueueUrl!,
                Entries: Messages.map(m => ({
                    Id: m.MessageId!,
                    ReceiptHandle: m.ReceiptHandle!
                }))
            }).catch(_ => {});
            metrics.sqs64kRequests++;
        }
        return {
            Messages: Messages.map(processIncomingQueueMessage).filter(defined),
            isFullMessageBatch: Messages.length === MaxNumberOfMessages
        };
    } catch (err) {
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

function processIncomingQueueMessage(m: SQSMessage): Message | void {
    // AWS Lambda Destinations
    // (https://aws.amazon.com/blogs/compute/introducing-aws-lambda-destinations/)
    // are used to route failures to the response queue. These
    // messages are generated by AWS Lambda and are constrained to the format it
    // provides.
    const raw = deserialize(m.Body!);
    if (raw.responseContext?.functionError) {
        const message = raw as LambdaDestinationMessage;
        const snsMessage = message.requestPayload as SNSEvent;
        const record = snsMessage.Records[0];
        const sCall: FunctionCall = deserialize(record.Sns.Message);
        const destinationError = message.responsePayload as LambdaDestinationError;
        const error = processAwsErrorMessage(destinationError.errorMessage);
        error.stack = destinationError.stackTrace?.join("\n");
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
        if (message.kind === "promise" || message.kind === "iterator") {
            message.timestamp = Number(m.Attributes!.SentTimestamp);
        }
        return raw;
    }
}
