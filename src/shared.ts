export interface CallId {
    CallId: string;
}

export interface FunctionCall extends CallId {
    name: string;
    args: any[];
    ResponseQueueId?: string;
    start: number;
}

export interface FunctionReturn extends CallId {
    type: "returned" | "error";
    value?: any;
    executionStart?: number;
    executionEnd?: number;
    retries?: number;
    rawResponse?: any;
}

export class Stats {
    samples: number = 0;
    max: number = Number.NEGATIVE_INFINITY;
    min: number = Number.POSITIVE_INFINITY;
    variance: number = NaN;
    protected _mean: number = 0;

    // https://math.stackexchange.com/questions/374881/recursive-formula-for-variance
    update(value: number) {
        this.samples++;
        const previousMean = this._mean;
        this._mean = previousMean + (value - previousMean) / this.samples;
        const previousVariance = Number.isNaN(this.variance) ? 0 : this.variance;
        this.variance =
            ((previousVariance + (previousMean - value) ** 2 / this.samples) *
                (this.samples - 1)) /
            this.samples;
        if (value > this.max) {
            this.max = value;
        }
        if (value < this.min) {
            this.min = value;
        }
    }

    get stdev() {
        return Math.sqrt(this.variance);
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
}

export function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}
