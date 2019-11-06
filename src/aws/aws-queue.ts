import { SNSEvent } from "aws-lambda";
import { SNS, SQS } from "aws-sdk";
import { FaastError } from "../error";
import { log } from "../log";
import {
    CALLID_ATTR,
    DeadLetterMessage,
    KIND_ATTR,
    Message,
    PollResult,
    ReceivableKind,
    ReceivableMessage
} from "../provider";
import { deserializeMessage, serializeMessage } from "../serialize";
import { computeHttpResponseBytes, defined, sum } from "../shared";
import { Attributes } from "../types";
import { FunctionCallSerialized } from "../wrapper";
import { AwsMetrics } from "./aws-faast";

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
            const body = serializeMessage(message.body);
            return publishSQS(sqs, QueueUrl, body, {
                ...kind,
                [CALLID_ATTR]: message.callId
            });
        case "cpumetrics":
            return publishSQS(sqs, QueueUrl, serializeMessage(message), kind);
    }
}

export function publishFunctionCallMessage(
    sns: SNS,
    TopicArn: string,
    message: FunctionCallSerialized,
    metrics: AwsMetrics
) {
    const serialized = serializeMessage(message);
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
    if (message?.match(/Process exited before completing/)) {
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

function processIncomingQueueMessage(m: SQS.Message): ReceivableMessage | void {
    // Check for dead letter messages first.
    // https://docs.aws.amazon.com/lambda/latest/dg/dlq.html
    const errorMessage = sqsMessageAttribute(m, "ErrorMessage");
    /* istanbul ignore if  */
    if (errorMessage) {
        log.info(`Received DLQ message: %O`, m);
        const body = m.Body && JSON.parse(m.Body);
        const snsMessage: SNSEvent = body;
        const record = snsMessage.Records[0];
        try {
            // Dead letter messages are generated by AWS and do not have a CallId attribute, we must get the call ID from the message body.
            const callRequest: FunctionCallSerialized = deserializeMessage(
                record.Sns.Message
            );
            const error = processAwsErrorMessage(errorMessage!);
            return {
                kind: "deadletter",
                callId: callRequest.callId,
                message: error.message
            };
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
                body: deserializeMessage(m.Body),
                rawResponse: m,
                timestamp
            };
        case "functionstarted":
            if (!callId) {
                return;
            }
            return { kind, callId };
        case "cpumetrics":
            return deserializeMessage(m.Body!);
    }
}
