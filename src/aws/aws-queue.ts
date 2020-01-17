import { SNSEvent } from "aws-lambda";
import { SNS, SQS } from "aws-sdk";
import { FaastError } from "../error";
import { log } from "../log";
import {
    CALLID_ATTR,
    KIND_ATTR,
    Message,
    PollResult,
    Kind,
    ResponseMessage
} from "../provider";
import { deserialize, serialize } from "../serialize";
import { computeHttpResponseBytes, defined, sum } from "../shared";
import { Attributes } from "../types";
import { FunctionCall, createErrorResponse } from "../wrapper";
import { AwsMetrics } from "./aws-faast";
import { inspect } from "util";

function sqsMessageAttribute(message: SQS.Message, attr: string) {
    const a = message.MessageAttributes;
    return a?.[attr]?.StringValue;
}

export async function createSNSTopic(sns: SNS, Name: string) {
    const topic = await sns.createTopic({ Name }).promise();
    return topic.TopicArn!;
}

function countRequests(bytes: number) {
    return Math.ceil(bytes / (64 * 1024));
}

function convertMapToAwsMessageAttributes(
    attributes?: Attributes
): SNS.MessageAttributeMap {
    const attr: SNS.MessageAttributeMap = {};
    attributes &&
        Object.keys(attributes).forEach(
            key => (attr[key] = { DataType: "String", StringValue: attributes[key] })
        );
    return attr;
}

async function publishSQS(
    sqs: SQS,
    QueueUrl: string,
    MessageBody: string,
    attr?: Attributes
) {
    const message = {
        QueueUrl,
        MessageBody,
        MessageAttributes: convertMapToAwsMessageAttributes(attr)
    };
    await sqs.sendMessage(message).promise();
}

export function sendResponseQueueMessage(sqs: SQS, QueueUrl: string, message: Message) {
    const kind = { [KIND_ATTR]: message.kind };
    switch (message.kind) {
        case "functionstarted":
            return publishSQS(sqs, QueueUrl, "{}", {
                ...kind,
                [CALLID_ATTR]: message.callId
            });
        case "response":
            const body = serialize(message.body);
            return publishSQS(sqs, QueueUrl, body, {
                ...kind,
                [CALLID_ATTR]: message.callId
            });
        case "cpumetrics":
            return publishSQS(sqs, QueueUrl, serialize(message), kind);
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
    return sns
        .publish({
            TopicArn,
            Message: serialized
        })
        .promise();
}

export async function createSQSQueue(QueueName: string, VTimeout: number, sqs: SQS) {
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
}

/* istanbul ignore next  */
export function processAwsErrorMessage(message: string): Error {
    let err = new FaastError(message);
    err = new FaastError(err, "lambda execution error");
    if (
        message?.match(/Process exited before completing/) ||
        message?.match(/signal: killed/)
    ) {
        err = new FaastError(err, "possibly out of memory");
    }
    return err;
}

export async function receiveMessages(
    sqs: SQS,
    ResponseQueueUrl: string,
    metrics: AwsMetrics,
    cancel: Promise<void>
): Promise<PollResult> {
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
        }).promise();
        metrics.sqs64kRequests++;
    }
    return {
        Messages: Messages.map(processIncomingQueueMessage).filter(defined),
        isFullMessageBatch: Messages.length === MaxNumberOfMessages
    };
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
    const timestamp = Number(m.Attributes!.SentTimestamp);
    // AWS Lambda Destinations
    // (https://aws.amazon.com/blogs/compute/introducing-aws-lambda-destinations/)
    // are used to route failures to the response queue. These
    // messages are generated by AWS Lambda and are constrained to the format it
    // provides.
    const kind = sqsMessageAttribute(m, KIND_ATTR) as Kind | undefined;
    if (kind === undefined) {
        const body = JSON.parse(m.Body!) as LambdaDestinationMessage;
        if (body.responseContext.functionError) {
            const snsMessage = body.requestPayload as SNSEvent;
            const record = snsMessage.Records[0];
            const sCall: FunctionCall = deserialize(record.Sns.Message);
            const destinationError = body.responsePayload as LambdaDestinationError;
            const error = processAwsErrorMessage(destinationError.errorMessage);
            error.stack = destinationError.stackTrace?.join("\n");
            const executionId = body.requestContext.requestId;
            return {
                kind: "response",
                callId: sCall.callId,
                body: createErrorResponse(error, {
                    call: sCall,
                    startTime: new Date(record.Sns.Timestamp).getTime(),
                    executionId
                }),
                timestamp: new Date(body.timestamp).getTime()
            };
        } else {
            log.warn(`Unknown message: ${inspect(body, undefined, 9)}`);
            return;
        }
    }

    const callId = sqsMessageAttribute(m, CALLID_ATTR);
    switch (kind) {
        case "response":
            if (!callId || !m.Body) {
                return;
            }
            return {
                kind,
                callId,
                body: deserialize(m.Body),
                rawResponse: m,
                timestamp
            };
        case "functionstarted":
            if (!callId) {
                return;
            }
            return { kind, callId };
        case "cpumetrics":
            return deserialize(m.Body!);
    }
}
