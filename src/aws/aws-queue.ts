import * as aws from "aws-sdk";
import * as cloudqueue from "../queue";

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

export function publishControlMessage(
    sqs: aws.SQS,
    ResponseQueueUrl: string,
    type: cloudqueue.ControlMessageType,
    attr?: cloudqueue.Attributes
): Promise<any> {
    const message = {
        QueueUrl: ResponseQueueUrl,
        MessageBody: "empty",
        MessageAttributes: convertMapToAWSMessageAttributes({
            cloudify: type,
            ...(attr || {})
        })
    };
    return sqs.sendMessage(message).promise();
}

export function isControlMessage(
    message: aws.SQS.Message,
    type: cloudqueue.ControlMessageType
) {
    const attr = message.MessageAttributes;
    const cloudify = attr && attr["cloudify"];
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
