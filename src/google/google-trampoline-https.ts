import { Request, Response } from "express";
import { callFunc, createErrorResponse, parseFunc } from "./google-trampoline-shared";

export { registerAllFunctions } from "./google-trampoline-shared";

export async function trampoline(request: Request, response: Response) {
    let CallId: string | undefined;
    const executionStart = Date.now();
    try {
        const parsedFunc = parseFunc(request.body);
        CallId = parsedFunc.CallId;
        const returned = await callFunc(parsedFunc, executionStart);
        response.send(returned);
    } catch (err) {
        response.send(createErrorResponse(err, CallId, executionStart));
    }
}

console.log(`Successfully loaded cloudify trampoline function.`);
