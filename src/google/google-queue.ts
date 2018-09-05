import { pubsub_v1 } from "googleapis";
import * as cloudqueue from "../queue";
import PubSubApi = pubsub_v1;
import { Attributes } from "../type-helpers";
import { GoogleCostMetrics } from "./google-cloudify";
import { computeHttpResponseBytes } from "../shared";

export function pubsubMessageAttribute(
    { message }: PubSubApi.Schema$ReceivedMessage,
    attr: string
) {
    const attributes = message && message.attributes;
    return attributes && (attributes[attr] as string);
}

export async function receiveMessages(
    pubsub: PubSubApi.Pubsub,
    responseSubscription: string,
    metrics: GoogleCostMetrics
): Promise<cloudqueue.ReceivedMessages<PubSubApi.Schema$ReceivedMessage>> {
    // Does higher message batching lead to better throughput? 10 is the max that AWS SQS allows.
    const maxMessages = 10;
    const response = await pubsub.projects.subscriptions.pull({
        subscription: responseSubscription,
        requestBody: { returnImmediately: false, maxMessages }
    });
    metrics.outboundBytes += computeHttpResponseBytes(response.headers);
    metrics.pubSubBytes +=
        computeHttpResponseBytes(response.headers, { httpHeaders: false, min: 1024 }) * 2;
    const Messages = response.data.receivedMessages || [];
    if (Messages.length > 0) {
        pubsub.projects.subscriptions.acknowledge({
            subscription: responseSubscription,
            requestBody: {
                ackIds: Messages.map(m => m.ackId || "").filter(m => m !== "")
            }
        });
    }
    return { Messages, isFullMessageBatch: Messages.length === maxMessages };
}

export function publishControlMessage(
    type: cloudqueue.ControlMessageType,
    pubsub: PubSubApi.Pubsub,
    topic: string,
    attr?: Attributes
) {
    return publish(pubsub, topic, "empty", { cloudify: type, ...attr });
}

export function getMessageBody(received: PubSubApi.Schema$ReceivedMessage) {
    const data = (received.message && received.message.data) || "";
    return Buffer.from(data, "base64").toString();
}

export async function publish(
    pubsub: PubSubApi.Pubsub,
    topic: string,
    message: string,
    attributes?: Attributes,
    metrics?: GoogleCostMetrics
) {
    const data = Buffer.from(message).toString("base64");
    const publishResponse = await pubsub.projects.topics.publish({
        topic,
        requestBody: { messages: [{ data, attributes }] }
    });
    if (metrics) {
        metrics.pubSubBytes += computeHttpResponseBytes(publishResponse.headers, {
            httpHeaders: false,
            min: 1024
        });
    }
    return publishResponse;
}
