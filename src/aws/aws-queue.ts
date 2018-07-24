import * as aws from "aws-sdk";
import * as cloudqueue from "../queue";
import { log } from "../log";
import { SNSEvent } from "aws-lambda";
import { FunctionCall } from "../shared";

export function sqsMessageAttribute(message: aws.SQS.Message, attr: string) {
    const a = message.MessageAttributes;
    if (!a) {
        return undefined;
    }
    return a[attr] && a[attr].StringValue;
}

function convertMapToAWSMessageAttributes(
    attributes?: cloudqueue.Attributes
): aws.SNS.MessageAttributeMap {
    const attr: aws.SNS.MessageAttributeMap = {};
    attributes &&
        Object.keys(attributes).forEach(
            key => (attr[key] = { DataType: "String", StringValue: attributes[key] })
        );
    return attr;
}

export async function createSNSTopic(sns: aws.SNS, Name: string) {
    const topic = await sns.createTopic({ Name }).promise();
    return topic.TopicArn!;
}

export function publishSNS(
    sns: aws.SNS,
    TopicArn: string,
    body: string,
    attributes?: cloudqueue.Attributes
) {
    return sns
        .publish({
            TopicArn,
            Message: body,
            MessageAttributes: convertMapToAWSMessageAttributes(attributes)
        })
        .promise();
}

export async function createSQSQueue(
    QueueName: string,
    VTimeout: number,
    sqs: aws.SQS,
    deadLetterTargetArn?: string
) {
    const createQueueRequest: aws.SQS.CreateQueueRequest = {
        QueueName,
        Attributes: {
            VisibilityTimeout: `${VTimeout}`
        }
    };
    if (deadLetterTargetArn) {
        createQueueRequest.Attributes!.RedrivePolicy = JSON.stringify({
            maxReceiveCount: "5",
            deadLetterTargetArn
        });
    }
    const response = await sqs.createQueue(createQueueRequest).promise();
    return response.QueueUrl!;
}

export function publishSQS(
    sqs: aws.SQS,
    QueueUrl: string,
    MessageBody: string,
    attr?: cloudqueue.Attributes
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
    attr?: cloudqueue.Attributes
) {
    return publishSQS(sqs, QueueUrl, "control message", { cloudify: type, ...attr });
}

export function isControlMessage(
    message: aws.SQS.Message,
    type: cloudqueue.ControlMessageType
) {
    const attr = message.MessageAttributes;
    const cloudify = attr && attr.cloudify;
    const value = cloudify && cloudify.StringValue;
    return value === type;
}

export async function receiveMessages(
    sqs: aws.SQS,
    ResponseQueueUrl: string
): Promise<cloudqueue.ReceivedMessages<aws.SQS.Message>> {
    const MaxNumberOfMessages = 10;
    const response = await sqs
        .receiveMessage({
            QueueUrl: ResponseQueueUrl!,
            WaitTimeSeconds: 20,
            MaxNumberOfMessages,
            MessageAttributeNames: ["All"]
        })
        .promise();
    const { Messages = [] } = response;
    if (Messages.length > 0) {
        sqs.deleteMessageBatch({
            QueueUrl: ResponseQueueUrl!,
            Entries: Messages.map(m => ({
                Id: m.MessageId!,
                ReceiptHandle: m.ReceiptHandle!
            }))
        }).promise();
    }
    return { Messages, isFullMessageBatch: Messages.length === MaxNumberOfMessages };
}

export async function createDLQ(FunctionName: string, sqs: aws.SQS) {
    let DLQUrl: string | undefined;
    let DLQArn: string | undefined;
    try {
        DLQUrl = await createSQSQueue(`${FunctionName}-DLQ`, 60, sqs);
        const DLQResponse = await sqs
            .getQueueAttributes({
                QueueUrl: DLQUrl,
                AttributeNames: ["QueueArn"]
            })
            .promise();
        DLQArn =
            (DLQResponse && DLQResponse.Attributes && DLQResponse.Attributes.QueueArn) ||
            undefined;
    } catch (err) {
        warn(err);
    }
    return { DLQUrl, DLQArn };
}

export function processAWSErrorMessage(message: string) {
    if (message && message.match(/Process exited before completing/)) {
        message += " (cloudify: possibly out of memory)";
    }
    return message;
}

export async function receiveDLQMessages(
    sqs: aws.SQS,
    DLQUrl: string
): Promise<cloudqueue.QueueError[]> {
    const { Messages } = await receiveMessages(sqs, DLQUrl);
    const rv = [];
    for (const m of Messages) {
        try {
            // https://docs.aws.amazon.com/lambda/latest/dg/dlq.html
            const errorMessage = sqsMessageAttribute(m, "ErrorMessage");
            const body = m.Body && JSON.parse(m.Body);
            const snsMessage: SNSEvent = body;
            for (const record of snsMessage.Records) {
                const callRequest: FunctionCall = JSON.parse(record.Sns.Message);
                rv.push({ callRequest, message: processAWSErrorMessage(errorMessage!) });
            }
        } catch (err) {
            warn(err);
        }
    }
    return rv;
}
