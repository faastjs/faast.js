import { Request, Response } from "express";
import { google, pubsub_v1 } from "googleapis";
import { createErrorResponse, FunctionCall, Wrapper } from "../wrapper";
import { publishResponseMessage } from "./google-queue";
import { getExecutionLogUrl, shouldRetryRequest } from "./google-shared";
import PubSubApi = pubsub_v1;

export const filename = module.filename;

let pubsub: PubSubApi.Pubsub;

async function initialize() {
    if (!pubsub) {
        const auth = await google.auth.getClient({
            scopes: ["https://www.googleapis.com/auth/cloud-platform"]
        });
        google.options({
            auth,
            retryConfig: {
                retry: 3,
                noResponseRetries: 3,
                shouldRetry: shouldRetryRequest(console.log)
            }
        });
        pubsub = google.pubsub("v1");
    }
}

export function makeTrampoline(wrapper: Wrapper) {
    async function trampoline(request: Request, response: Response) {
        const startTime = Date.now();
        await initialize();
        const call: FunctionCall = request.body;
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
            const results = [];
            for await (const result of wrapper.execute(callingContext, {
                onCpuUsage: metrics =>
                    publishResponseMessage(pubsub, call.ResponseQueueId!, {
                        kind: "cpumetrics",
                        callId: call.callId,
                        metrics
                    })
            })) {
                results.push(result);
            }

            response.send(results);
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
