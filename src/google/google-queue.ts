import { pubsub_v1 } from "googleapis";
import { warn } from "../log";
import {
    CALLID_ATTR,
    KIND_ATTR,
    PollResult,
    ReceivableKind,
    ReceivableMessage,
    DeadLetterMessage,
    Message
} from "../provider";
import { assertNever, computeHttpResponseBytes, defined } from "../shared";
import { Attributes } from "../types";
import { GoogleMetrics } from "./google-faast";
import PubSubApi = pubsub_v1;

import PubSubMessage = pubsub_v1.Schema$PubsubMessage;
import { serializeReturn } from "../wrapper";

function pubsubMessageAttribute(message: PubSubMessage, attr: string) {
    const attributes = message && message.attributes;
    return attributes && (attributes[attr] as string);
}

export async function receiveMessages(
    pubsub: PubSubApi.Pubsub,
    responseSubscription: string,
    metrics: GoogleMetrics
): Promise<PollResult> {
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
    return {
        Messages: Messages.map(m => m.message!)
            .map(processMessage)
            .filter(defined),
        isFullMessageBatch: Messages.length === maxMessages
    };
}

function parseTimestamp(timestampStr: string | undefined) {
    return Date.parse(timestampStr || "") || 0;
}

function processMessage(m: PubSubMessage): ReceivableMessage | void {
    const kind = pubsubMessageAttribute(m, KIND_ATTR) as ReceivableKind;
    const CallId = pubsubMessageAttribute(m, CALLID_ATTR);
    const timestamp = parseTimestamp(m.publishTime!);

    switch (kind) {
        case "deadletter":
            warn("Not expecting deadletter message from google queue");
            return;
        case "stopqueue":
            return { kind };
        case "functionstarted":
            if (!CallId) {
                return;
            }
            return { kind, CallId };
        case "response":
            if (!CallId || !m.data) {
                return;
            }
            const data = m.data || "";
            const body = Buffer.from(data, "base64").toString();
            return { kind, CallId, body, rawResponse: m, timestamp };
    }
    assertNever(kind);
}

export async function publishPubSub(
    pubsub: PubSubApi.Pubsub,
    topic: string,
    message: string,
    attributes?: Attributes
) {
    const data = Buffer.from(message).toString("base64");
    await pubsub.projects.topics.publish({
        topic,
        requestBody: { messages: [{ data, attributes }] }
    });
}

export function publishResponseMessage(
    pubsub: PubSubApi.Pubsub,
    ResponseQueue: string,
    message: Exclude<Message, DeadLetterMessage>
) {
    switch (message.kind) {
        case "stopqueue":
            return publishPubSub(pubsub, ResponseQueue, "", {
                [KIND_ATTR]: message.kind
            });
        case "functionstarted":
            return publishPubSub(pubsub, ResponseQueue, "", {
                [KIND_ATTR]: message.kind,
                [CALLID_ATTR]: message.CallId
            });
        case "response":
            const body =
                typeof message.body === "string"
                    ? message.body
                    : serializeReturn(message.body);
            return publishPubSub(pubsub, ResponseQueue, body, {
                [KIND_ATTR]: message.kind,
                [CALLID_ATTR]: message.CallId
            });
    }
    assertNever(message);
}
