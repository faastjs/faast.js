import { Response } from "./cloudify";

export interface FunctionCall {
    name: string;
    args: any[];
    CallId: string;
    ResponseQueueId?: string;
}

export interface FunctionReturn {
    type: "returned" | "error";
    value?: any;
    CallId: string;
    start?: number;
    end?: number;
}

export interface FunctionStats {
    callsCompleted: number;
    callsRequested: number;
    startLatencies: number[];
    executionLatencies: number[];
    returnLatencies: number[];
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
    const rv: Response<ReturnType<any>> = { value, error, rawResponse };
    return rv;
}
