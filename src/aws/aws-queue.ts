import { SNSEvent } from "aws-lambda";
import * as aws from "aws-sdk";
import { info, warn } from "../log";
import * as cloudqueue from "../queue";
import { computeHttpResponseBytes, sum } from "../shared";
import { Attributes } from "../types";
import { FunctionCall } from "../wrapper";
import { AWSMetrics } from "./aws-faast";

export function sqsMessageAttribute(message: aws.SQS.Message, attr: string) {
    const a = message.MessageAttributes;
    if (!a) {
        return undefined;
    }
    return a[attr] && a[attr].StringValue;
}

export async function createSNSTopic(sns: aws.SNS, Name: string) {
    const topic = await sns.createTopic({ Name }).promise();
    return topic.TopicArn!;
}

function countRequests(bytes: number) {
    return Math.ceil(bytes / (64 * 1024));
}

export function convertMapToAWSMessageAttributes(
    attributes?: Attributes
): aws.SNS.MessageAttributeMap {
    const attr: aws.SNS.MessageAttributeMap = {};
    attributes &&
        Object.keys(attributes).forEach(
            key => (attr[key] = { DataType: "String", StringValue: attributes[key] })
        );
    return attr;
}

export function publishSQS(
    sqs: aws.SQS,
    QueueUrl: string,
    MessageBody: string,
    attr?: Attributes
): Promise<any> {
    const message = {
        QueueUrl,
        MessageBody,
        MessageAttributes: convertMapToAWSMessageAttributes(attr)
    };
    return sqs.sendMessage(message).promise();
}

export function publishSQSControlMessage(
    type: cloudqueue.ControlMessageType,
    sqs: aws.SQS,
    QueueUrl: string,
    attr?: Attributes
) {
    return publishSQS(sqs, QueueUrl, "control message", {
        faast: type,
        ...attr
    });
}

export function publishSNS(
    sns: aws.SNS,
    TopicArn: string,
    body: string,
    costMetrics: AWSMetrics,
    attributes?: Attributes
) {
    costMetrics.sns64kRequests += countRequests(body.length);
    return sns
        .publish({
            TopicArn,
            Message: body,
            MessageAttributes: convertMapToAWSMessageAttributes(attributes)
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

export function isControlMessage(
    message: aws.SQS.Message,
    type: cloudqueue.ControlMessageType
) {
    const attr = message.MessageAttributes;
    const faast = attr && attr.faast;
    const value = faast && faast.StringValue;
    return value === type;
}

export async function receiveMessages(
    sqs: aws.SQS,
    ResponseQueueUrl: string,
    metrics: AWSMetrics
): Promise<cloudqueue.ReceivedMessages<aws.SQS.Message>> {
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
        Messages,
        isFullMessageBatch: Messages.length === MaxNumberOfMessages
    };
}

export function processAWSErrorMessage(message: string) {
    if (message && message.match(/Process exited before completing/)) {
        message += " (faast: possibly out of memory)";
    }
    return message;
}

export function deadLetterMessages(
    m: aws.SQS.Message
): cloudqueue.DeadLetter[] | undefined {
    // https://docs.aws.amazon.com/lambda/latest/dg/dlq.html
    const errorMessage = sqsMessageAttribute(m, "ErrorMessage");
    if (!errorMessage) {
        return;
    }
    info(`Received DLQ message: %O`, m);
    const body = m.Body && JSON.parse(m.Body);
    const snsMessage: SNSEvent = body;
    const rv = [];
    for (const record of snsMessage.Records) {
        try {
            const callRequest: FunctionCall = JSON.parse(record.Sns.Message);
            rv.push({ callRequest, message: processAWSErrorMessage(errorMessage!) });
        } catch (err) {
            warn(err);
        }
    }
    return rv;
}
