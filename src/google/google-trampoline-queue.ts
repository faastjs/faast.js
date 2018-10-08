import { google, pubsub_v1 } from "googleapis";
import { publish, publishControlMessage } from "./google-queue";
import { ModuleWrapper, FunctionCall, createErrorResponse } from "../trampoline";
import PubSubApi = pubsub_v1;

export const moduleWrapper = new ModuleWrapper();

interface CloudFunctionContext {
    eventId: string;
    timestamp: string;
    eventType: string;
    resource: object;
}

let pubsub: PubSubApi.Pubsub;

async function initialize() {
    if (!pubsub) {
        const auth = await google.auth.getClient({
            scopes: ["https://www.googleapis.com/auth/cloud-platform"]
        });
        google.options({ auth });
        pubsub = google.pubsub("v1");
    }
}

export async function trampoline(
    data: PubSubApi.Schema$PubsubMessage,
    _context: CloudFunctionContext
): Promise<void> {
    const start = Date.now();
    await initialize();
    const str = Buffer.from(data.data!, "base64");
    const call: FunctionCall = JSON.parse(str.toString());
    const { CallId, ResponseQueueId } = call;
    const startedMessageTimer = setTimeout(
        () =>
            publishControlMessage("functionstarted", pubsub, ResponseQueueId!, {
                CallId
            }),
        2 * 1000
    );

    try {
        const returned = await moduleWrapper.execute(call, start);
        clearTimeout(startedMessageTimer);
        await publish(pubsub, call.ResponseQueueId!, JSON.stringify(returned), {
            CallId
        });
    } catch (err) {
        console.error(err);
        if (ResponseQueueId) {
            const response = createErrorResponse(err, call, start);
            await publish(pubsub, ResponseQueueId!, JSON.stringify(response), {
                CallId
            });
        }
    }
}
