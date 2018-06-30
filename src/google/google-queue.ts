import { pubsub_v1 } from "googleapis";
import * as cloudqueue from "../queue";
import PubSubApi = pubsub_v1;

export function pubsubMessageAttribute(
    { message }: PubSubApi.Schema$ReceivedMessage,
    attr: string
) {
    const attributes = message && message.attributes;
    return attributes && (attributes[attr] as string);
}

export async function receiveMessages(
    pubsub: PubSubApi.Pubsub,
    responseSubscription: string
) {
    const response = await pubsub.projects.subscriptions.pull({
        subscription: responseSubscription,
        // XXX maxMessages?
        requestBody: { returnImmediately: false, maxMessages: 10 }
    });
    const messages = response.data.receivedMessages || [];
    if (messages.length > 0) {
        pubsub.projects.subscriptions.acknowledge({
            subscription: responseSubscription,
            requestBody: {
                ackIds: messages.map(m => m.ackId || "").filter(m => m != "")
            }
        });
    }
    return messages;
}

export async function publish(
    pubsub: PubSubApi.Pubsub,
    topic: string,
    data: string,
    attributes?: cloudqueue.Attributes
) {
    return pubsub.projects.topics.publish({
        topic,
        requestBody: { messages: [{ data, attributes }] }
    });
}
