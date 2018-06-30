import { Response } from "./cloudify";

export interface FunctionCall {
    name: string;
    args: any[];
    CallId: string;
    ResponseQueueUrl?: string;
}

export interface FunctionReturn {
    type: "returned" | "error";
    value?: any;
    CallId: string;
}

export function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export function processResponse(
    error: Error | undefined,
    returned: FunctionReturn | undefined,
    rawResponse: any
) {
    if (returned && returned.type === "error") {
        const errValue = returned.value;
        error = new Error(errValue.message);
        error.name = errValue.name;
        error.stack = errValue.stack;
    }
    const value = !error && returned && returned.value;
    let rv: Response<ReturnType<any>> = { value, error, rawResponse };
    return rv;
}
