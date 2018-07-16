import { google, pubsub_v1 } from "googleapis";
import { publish, publishControlMessage } from "./google-queue";
import PubSubApi = pubsub_v1;
import { parseFunc, callFunc, createErrorResponse } from "./google-trampoline-shared";

export { registerAllFunctions } from "./google-trampoline-shared";

interface CloudFunctionContext {
    eventId: string;
    timestamp: string;
    eventType: string;
    resource: object;
}

interface CloudFunctionPubSubEvent {
    data: PubSubApi.Schema$PubsubMessage;
    context: CloudFunctionContext;
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

export async function trampoline(event: CloudFunctionPubSubEvent): Promise<void> {
    const start = Date.now();
    await initialize();
    let CallId: string = "";
    let ResponseQueueId: string | undefined;
    try {
        const startedMessageTimer = setTimeout(
            () =>
                publishControlMessage("functionstarted", pubsub, ResponseQueueId!, {
                    CallId
                }),
            2 * 1000
        );
        const str = Buffer.from(event.data.data!, "base64");
        const parsedFunc = parseFunc(JSON.parse(str.toString()));
        ({ CallId, ResponseQueueId } = parsedFunc);
        const returned = await callFunc(parsedFunc, start);
        clearTimeout(startedMessageTimer);
        await publish(pubsub, ResponseQueueId!, JSON.stringify(returned), { CallId });
    } catch (err) {
        console.error(err);
        if (ResponseQueueId) {
            const response = createErrorResponse(err, CallId, start);
            await publish(pubsub, ResponseQueueId!, JSON.stringify(response), { CallId });
        }
    }
}

console.log(`Successfully loaded cloudify trampoline function.`);
