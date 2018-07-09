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
    executionStart?: number;
    executionEnd?: number;
    rawResponse?: any;
}

export class Stats {
    samples: number = 0;
    max: number = Number.NEGATIVE_INFINITY;
    min: number = Number.POSITIVE_INFINITY;
    protected _mean: number = 0;
    protected _sumOfSquares: number = 0;

    update(value: number) {
        this.samples++;
        const previousMean = this._mean;
        this._mean = previousMean + (value - previousMean) / this.samples;
        this._sumOfSquares =
            this._sumOfSquares + (value - this._mean) * (value - previousMean);
        if (value > this.max) {
            this.max = value;
        }
        if (value < this.min) {
            this.min = value;
        }
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
