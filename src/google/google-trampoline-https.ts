import { Request, Response } from "express";
import { env } from "process";
import { createErrorResponse, FunctionCall, Wrapper } from "../wrapper";
import { getExecutionLogUrl } from "./google-shared";

export const filename = module.filename;

export function makeTrampoline(wrapper: Wrapper) {
    async function trampoline(request: Request, response: Response) {
        const startTime = Date.now();
        const call: FunctionCall = JSON.parse(request.body) as FunctionCall;
        const executionId = request.headers["function-execution-id"] as string;
        const project = env["GCP_PROJECT"]!;
        const functionName = env["FUNCTION_NAME"]!;
        const logUrl = getExecutionLogUrl(project, functionName, executionId);
        const callingContext = {
            call,
            startTime,
            logUrl,
            executionId
        };
        try {
            const returned = await wrapper.execute(callingContext);
            response.send(returned);
        } catch (err) {
            console.error(err);
            response.send(createErrorResponse(err, callingContext));
        }
    }
    return { trampoline };
}
