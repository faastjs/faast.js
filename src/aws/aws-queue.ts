import { SNSEvent } from "aws-lambda";
import { SQS, SNS } from "aws-sdk";
import { log } from "../log";
import {
    CALLID_ATTR,
    Invocation,
    KIND_ATTR,
    PollResult,
    ReceivableKind,
    ReceivableMessage,
    Message,
    DeadLetterMessage
} from "../provider";
import { assertNever, computeHttpResponseBytes, defined, sum } from "../shared";
import { Attributes } from "../types";
import { FunctionCall } from "../wrapper";
import { AwsMetrics } from "./aws-faast";
import { serializeReturn } from "../serialize";

function sqsMessageAttribute(message: SQS.Message, attr: string) {
    const a = message.MessageAttributes;
    return a && a[attr] && a[attr].StringValue;
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

export function sendResponseQueueMessage(
    sqs: SQS,
    QueueUrl: string,
    message: Exclude<Message, DeadLetterMessage>
) {
    const kind = { [KIND_ATTR]: message.kind };
    switch (message.kind) {
        case "functionstarted":
            return publishSQS(sqs, QueueUrl, "{}", {
                ...kind,
                [CALLID_ATTR]: message.callId
            });
        case "response":
            const body =
                typeof message.body === "string"
                    ? message.body
                    : serializeReturn(message.body);
            return publishSQS(sqs, QueueUrl, body, {
                ...kind,
                [CALLID_ATTR]: message.callId
            });
        case "cpumetrics":
            return publishSQS(sqs, QueueUrl, JSON.stringify(message), kind);
    }
    assertNever(message);
}

export function publishInvocationMessage(
    sns: SNS,
    TopicArn: string,
    message: Invocation,
    metrics: AwsMetrics
) {
    metrics.sns64kRequests += countRequests(message.body.length);
    return sns
        .publish({
            TopicArn,
            Message: message.body
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
    const QueueArn = arnResponse.Attributes && arnResponse.Attributes.QueueArn;
    return { QueueUrl, QueueArn };
}

export function processAwsErrorMessage(message: string) {
    if (message && message.match(/Process exited before completing/)) {
        message += " (faast: possibly out of memory)";
    }
    return message;
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
        Messages.map(m => (m.Body && countRequests(m.Body.length)) || 1)
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

function processIncomingQueueMessage(m: SQS.Message): ReceivableMessage | void {
    // Check for dead letter messages first.
    // https://docs.aws.amazon.com/lambda/latest/dg/dlq.html
    const errorMessage = sqsMessageAttribute(m, "ErrorMessage");
    if (errorMessage) {
        log.info(`Received DLQ message: %O`, m);
        const body = m.Body && JSON.parse(m.Body);
        const snsMessage: SNSEvent = body;
        const record = snsMessage.Records[0];
        try {
            // Dead letter messages are generated by AWS and do not have a CallId attribute, we must get the call ID from the message body.
            const callRequest: FunctionCall = JSON.parse(record.Sns.Message);
            const message = processAwsErrorMessage(errorMessage!);
            return { kind: "deadletter", callId: callRequest.callId, message };
        } catch (err) {
            log.warn(err);
            return;
        }
    }

    const kind = sqsMessageAttribute(m, KIND_ATTR) as Exclude<
        ReceivableKind,
        "deadletter"
    >;
    const callId = sqsMessageAttribute(m, CALLID_ATTR);
    const timestamp = Number(m.Attributes!.SentTimestamp);
    switch (kind) {
        case "response":
            if (!callId || !m.Body) {
                return;
            }
            return {
                kind,
                callId,
                body: m.Body,
                rawResponse: m,
                timestamp
            };
        case "functionstarted":
            if (!callId) {
                return;
            }
            return { kind, callId };
        case "cpumetrics":
            return JSON.parse(m.Body!);
    }
    return assertNever(kind);
}
