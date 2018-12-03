import { Request, Response } from "express";
import { Wrapper, FunctionCall, createErrorResponse } from "../wrapper";
import { env } from "process";
import { getExecutionLogUrl } from "./google-shared";

export const filename = module.filename;

export function makeTrampoline(moduleWrapper: Wrapper) {
    async function trampoline(request: Request, response: Response) {
        const startTime = Date.now();
        const call: FunctionCall = request.body;
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
            const returned = await moduleWrapper.execute(callingContext);
            response.send(returned);
        } catch (err) {
            console.error(err);
            response.send(createErrorResponse(err, callingContext));
        }
    }
    return { trampoline };
}
