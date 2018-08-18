import { Request, Response } from "express";
import { moduleWrapper, FunctionCall } from "../trampoline";
export { registerModule } from "../trampoline";

export async function trampoline(request: Request, response: Response) {
    const executionStart = Date.now();
    const call: FunctionCall = request.body;
    try {
        const returned = await moduleWrapper.execute(call);
        response.send(returned);
    } catch (err) {
        response.send(moduleWrapper.createErrorResponse(err, call, executionStart));
    }
}

console.log(`Successfully loaded cloudify trampoline function.`);
