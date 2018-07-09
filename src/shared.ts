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

export class Stats {
    samples: number = 0;
    protected _mean: number = 0;
    protected _sumOfSquares: number = 0;

    update(value: number) {
        this.samples++;
        const previousMean = this._mean;
        this._mean = previousMean + (value - previousMean) / this.samples;
        this._sumOfSquares =
            this._sumOfSquares + (value - this._mean) * (value - previousMean);
    }

    get stdev() {
        return Math.sqrt(this._sumOfSquares / this.samples);
    }

    get mean() {
        return this.samples > 0 ? this._mean : NaN;
    }
}

export class FunctionStats {
    callsCompleted = 0;
    retries = 0;
    errors = 0;
    startLatency = new Stats();
    executionLatency = new Stats();
    returnLatency = new Stats();
    lastStatOutputTime = 0;
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
        if (stats) {
            stats.startLatency.update(startLatency);
            stats.executionLatency.update(executionLatency);
            stats.returnLatency.update(returnLatency);
        }
    }
    return rv;
}
