import { SNSEvent } from "aws-lambda";
import * as aws from "aws-sdk";
import { info, warn } from "../log";
import {
    CALLID_ATTR,
    Invocation,
    KIND_ATTR,
    PollResult,
    ReceivableKind,
    ReceivableMessage,
    SendableMessage
} from "../provider";
import { assertNever, computeHttpResponseBytes, defined, sum } from "../shared";
import { Attributes } from "../types";
import { FunctionCall, serializeReturn } from "../wrapper";
import { AWSMetrics } from "./aws-faast";

function sqsMessageAttribute(message: aws.SQS.Message, attr: string) {
    const a = message.MessageAttributes;
    return a && a[attr] && a[attr].StringValue;
}

export async function createSNSTopic(sns: aws.SNS, Name: string) {
    const topic = await sns.createTopic({ Name }).promise();
    return topic.TopicArn!;
}

function countRequests(bytes: number) {
    return Math.ceil(bytes / (64 * 1024));
}

function convertMapToAWSMessageAttributes(
    attributes?: Attributes
): aws.SNS.MessageAttributeMap {
    const attr: aws.SNS.MessageAttributeMap = {};
    attributes &&
        Object.keys(attributes).forEach(
            key => (attr[key] = { DataType: "String", StringValue: attributes[key] })
        );
    return attr;
}

function publishSQS(
    sqs: aws.SQS,
    QueueUrl: string,
    MessageBody: string,
    attr?: Attributes
): Promise<void> {
    const message = {
        QueueUrl,
        MessageBody,
        MessageAttributes: convertMapToAWSMessageAttributes(attr)
    };
    return sqs
        .sendMessage(message)
        .promise()
        .then(_ => {});
}

export function publishResponseMessage(
    sqs: aws.SQS,
    QueueUrl: string,
    message: SendableMessage
) {
    switch (message.kind) {
        case "stopqueue":
            return publishSQS(sqs, QueueUrl, "{}", { [KIND_ATTR]: message.kind });
        case "functionstarted":
            return publishSQS(sqs, QueueUrl, "{}", {
                [KIND_ATTR]: message.kind,
                [CALLID_ATTR]: message.CallId
            });
        case "response":
            const body =
                typeof message.body === "string"
                    ? message.body
                    : serializeReturn(message.body);
            return publishSQS(sqs, QueueUrl, body, {
                [KIND_ATTR]: message.kind,
                [CALLID_ATTR]: message.CallId
            });
    }
    assertNever(message);
}

export function publishInvocationMessage(
    sns: aws.SNS,
    TopicArn: string,
    message: Invocation,
    metrics: AWSMetrics
) {
    metrics.sns64kRequests += countRequests(message.body.length);
    return sns
        .publish({
            TopicArn,
            Message: message.body
        })
        .promise();
}

export async function createSQSQueue(QueueName: string, VTimeout: number, sqs: aws.SQS) {
    const createQueueRequest: aws.SQS.CreateQueueRequest = {
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

export function processAWSErrorMessage(message: string) {
    if (message && message.match(/Process exited before completing/)) {
        message += " (faast: possibly out of memory)";
    }
    return message;
}

export async function receiveMessages(
    sqs: aws.SQS,
    ResponseQueueUrl: string,
    metrics: AWSMetrics
): Promise<PollResult> {
    const MaxNumberOfMessages = 10;
    const response = await sqs
        .receiveMessage({
            QueueUrl: ResponseQueueUrl!,
            WaitTimeSeconds: 20,
            MaxNumberOfMessages,
            MessageAttributeNames: ["All"],
            AttributeNames: ["SentTimestamp"]
        })
        .promise();
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

function processIncomingQueueMessage(m: aws.SQS.Message): ReceivableMessage | void {
    // Check for dead letter messages first.
    // https://docs.aws.amazon.com/lambda/latest/dg/dlq.html
    const errorMessage = sqsMessageAttribute(m, "ErrorMessage");
    if (errorMessage) {
        info(`Received DLQ message: %O`, m);
        const body = m.Body && JSON.parse(m.Body);
        const snsMessage: SNSEvent = body;
        const record = snsMessage.Records[0];
        try {
            // Dead letter messages are generated by AWS and do not have a CallId attribute, we must get the call ID from the message body.
            const callRequest: FunctionCall = JSON.parse(record.Sns.Message);
            const message = processAWSErrorMessage(errorMessage!);
            return { kind: "deadletter", CallId: callRequest.CallId, message };
        } catch (err) {
            warn(err);
            return;
        }
    }

    const kind = sqsMessageAttribute(m, KIND_ATTR) as Exclude<
        ReceivableKind,
        "deadletter"
    >;
    const CallId = sqsMessageAttribute(m, CALLID_ATTR);
    const timestamp = Number(m.Attributes!.SentTimestamp);
    switch (kind) {
        case "response":
            if (!CallId || !m.Body) {
                return;
            }
            return {
                kind,
                CallId,
                body: m.Body,
                rawResponse: m,
                timestamp
            };
        case "functionstarted":
            if (!CallId) {
                return;
            }
            return { kind, CallId };
        case "stopqueue":
            return { kind };
    }
    assertNever(kind);
}
