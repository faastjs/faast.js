import { Request, Response } from "express";
import { google, pubsub_v1 } from "googleapis";
import { createErrorResponse, FunctionCall, Wrapper } from "../wrapper";
import { publishResponseMessage } from "./google-queue";
import { getExecutionLogUrl } from "./google-shared";
import PubSubApi = pubsub_v1;

export const filename = module.filename;

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

export function makeTrampoline(wrapper: Wrapper) {
    async function trampoline(request: Request, response: Response) {
        const startTime = Date.now();
        await initialize();
        const call: FunctionCall = JSON.parse(request.body) as FunctionCall;
        const executionId = request.headers["function-execution-id"] as string;
        const project = process.env["GCP_PROJECT"]!;
        const functionName = process.env["FUNCTION_NAME"]!;
        const logUrl = getExecutionLogUrl(project, functionName, executionId);
        const callingContext = {
            call,
            startTime,
            logUrl,
            executionId
        };
        try {
            const result = await wrapper.execute(callingContext, metrics =>
                publishResponseMessage(pubsub, call.ResponseQueueId!, {
                    kind: "cpumetrics",
                    callId: call.callId,
                    metrics
                })
            );
            response.send(result.returned);
        } catch (err) {
            /* istanbul ignore next */
            {
                console.error(err);
                response.send(createErrorResponse(err, callingContext));
            }
        }
    }
    return { trampoline };
}
