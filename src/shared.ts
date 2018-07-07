import { Response } from "./cloudify";

export interface FunctionCall {
    name: string;
    args: any[];
    CallId: string;
    ResponseQueueId?: string;
    start: number;
}

export interface FunctionReturn {
    type: "returned" | "error";
    value?: any;
    CallId: string;
    start: number;
    end: number;
}

export interface Latencies {
    startLatency: number;
    executionLatency: number;
    returnLatency: number;
}

export interface FunctionStats {
    callsCompleted: number;
    retries: number;
    errors: number;
    latencyStats: Latencies[];
    lastStatOutputTime: number;
}

export function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export function processResponse(
    error: Error | undefined,
    returned: FunctionReturn | undefined,
    rawResponse: any,
    start: number,
    stats?: FunctionStats
) {
    if (returned && returned.type === "error") {
        const errValue = returned.value;
        error = new Error(errValue.message);
        error.name = errValue.name;
        error.stack = errValue.stack;
    }
    const value = !error && returned && returned.value;
    let rv: Response<ReturnType<any>> = { value, error, rawResponse };
    if (returned) {
        const executionLatency = returned.end - returned.start;
        const startLatency = returned.start - start;
        const returnLatency = Date.now() - returned.end;
        const latencies = { executionLatency, startLatency, returnLatency };
        rv = { ...rv, ...latencies };
        stats && stats.latencyStats.push(latencies);
    }
    return rv;
}
