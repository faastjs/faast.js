import { isDeepStrictEqual } from "util";
import { warn, stats } from "./log";
import { Readable } from "stream";

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

export function deepCopyUndefined(dest: object, source: object) {
    const stack: object[] = [];
    function isBackReference(o: object) {
        for (const elem of stack) {
            if (elem === o) {
                return true;
            }
        }
        return false;
    }
    function recurse(d: object, s: object) {
        if (isBackReference(s) || d === undefined) {
            return;
        }
        stack.push(s);
        Object.keys(s).forEach(key => {
            if (s[key] && typeof s[key] === "object") {
                recurse(d[key], s[key]);
            } else if (s[key] === undefined) {
                d[key] = undefined;
            }
        });
        stack.pop();
    }
    typeof source === "object" && recurse(dest, source);
}

export function serializeCall(call: FunctionCall) {
    const callStr = JSON.stringify(call);
    const deserialized = JSON.parse(callStr);
    deepCopyUndefined(deserialized, call);
    if (!isDeepStrictEqual(deserialized, call)) {
        warn(`WARNING: problem serializing arguments to JSON`);
        warn(`deserialized arguments: %O`, deserialized);
        warn(`original arguments: %O`, call);
        warn(
            `Detected function '${
                call.name
            }' argument loses information when serialized by JSON.stringify()`
        );
    }
    return callStr;
}

export class Statistics {
    samples = 0;
    max = Number.NEGATIVE_INFINITY;
    min = Number.POSITIVE_INFINITY;
    variance = NaN;
    stdev = NaN;
    mean = NaN;

    // https://math.stackexchange.com/questions/374881/recursive-formula-for-variance
    update(value: number) {
        let previousMean = this.mean;
        let previousVariance = this.variance;
        if (this.samples === 0) {
            previousMean = 0;
            previousVariance = 0;
        }
        this.samples++;
        this.mean = previousMean + (value - previousMean) / this.samples;
        this.variance =
            ((previousVariance + (previousMean - value) ** 2 / this.samples) *
                (this.samples - 1)) /
            this.samples;
        this.stdev = Math.sqrt(this.variance);
        if (value > this.max) {
            this.max = value;
        }
        if (value < this.min) {
            this.min = value;
        }
    }

    toString() {
        return `${this.mean.toFixed(1)}`;
    }

    log(prefix: string = "", detailedOpt?: { detailed: boolean }) {
        const p = (n: number) => n.toFixed(1);
        if (detailedOpt && detailedOpt.detailed) {
            const { samples, mean, stdev, min, max } = this;
            stats(`${prefix}`);
            stats(`%O`, { samples, mean, stdev, min, max });
        } else {
            stats(`${prefix}: ${this.mean}`);
        }
    }
}

export class FactoryMap<K, V> extends Map<K, V> {
    constructor(readonly factory: () => V) {
        super();
    }

    getOrCreate(key: K) {
        let val = this.get(key);
        if (!val) {
            val = this.factory();
            this.set(key, val);
        }
        return val;
    }
}

export class CountersMap<K> extends FactoryMap<K, number> {
    constructor() {
        super(() => 0);
    }

    increment(key: K) {
        const current = this.getOrCreate(key) + 1;
        this.set(key, current);
    }

    toString() {
        return Array.from(this)
            .map(([key, value]) => `${key}: ${value}`)
            .join(", ");
    }

    log(prefix: string = "", _detailedOpt?: { detailed: boolean }) {
        for (const [key, value] of this) {
            stats(`${prefix} ${key}: ${value}`);
        }
    }
}

export class StatisticsMap<K extends string> extends FactoryMap<K, Statistics> {
    constructor() {
        super(() => new Statistics());
    }

    update(key: K, value: number) {
        this.getOrCreate(key).update(value);
    }

    toString() {
        return Array.from(this)
            .map(([key, value]) => `${key}: ${value.toString()}`)
            .join(", ");
    }

    log(prefix: string = "", detailedOpt?: { detailed: boolean }) {
        stats(`${prefix} statistics:`);
        for (const [metric, statistics] of this) {
            statistics.log(metric, detailedOpt);
        }
    }
}

export class Metrics<C, M extends string> {
    counters = new CountersMap<C>();
    statistics = new StatisticsMap<M>();

    increment(key: C) {
        this.counters.increment(key);
    }

    update(key: M, value: number) {
        this.statistics.update(key, value);
    }

    updateMany(obj: Partial<{ [key in M]: number }>) {
        for (const key of Object.keys(obj)) {
            this.update(key as M, obj[key]);
        }
    }

    toString() {
        return `${this.counters.toString()} ${this.statistics.toString()}`;
    }

    log(prefix: string = "", detailedOpt?: { detailed: boolean }) {
        if (detailedOpt && detailedOpt.detailed) {
            this.counters.log(prefix, detailedOpt);
            this.statistics.log(prefix, detailedOpt);
        } else {
            stats(`${prefix} ${this.toString()}`);
        }
    }
}

export class MetricsMap<C, M extends string> extends FactoryMap<string, Metrics<C, M>> {
    constructor() {
        super(() => new Metrics());
    }

    log(prefix: string = "", detailedOpt?: { detailed: boolean }) {
        for (const [key, metrics] of this) {
            metrics.log(`${prefix}${key}`, detailedOpt);
        }
    }
}

export class IncrementalMetricsMap<C, M extends string> extends MetricsMap<C, M> {
    incremental = new MetricsMap<C, M>();
    timer?: NodeJS.Timer;

    increment(key: string, counter: C) {
        this.getOrCreate(key).increment(counter);
        this.incremental.getOrCreate(key).increment(counter);
    }

    update(key: string, name: M, value: number) {
        this.getOrCreate(key).update(name, value);
        this.incremental.getOrCreate(key).update(name, value);
    }

    updateMany(key: string, obj: Partial<{ [property in M]: number }>) {
        this.getOrCreate(key).updateMany(obj);
        this.incremental.getOrCreate(key).updateMany(obj);
    }

    resetIncremental() {
        this.incremental = new MetricsMap();
    }

    logIncremental(prefix: string = "", detailedOpt?: { detailed: boolean }) {
        this.incremental.log(prefix, detailedOpt);
    }

    logInterval(interval: number) {
        this.timer && clearInterval(this.timer);
        this.timer = setInterval(() => {
            this.logIncremental();
            this.incremental = new MetricsMap();
        }, interval);
    }

    stopLogInterval() {
        this.timer && clearInterval(this.timer);
        this.timer = undefined;
    }
}

export type FunctionCounters = "completed" | "retries" | "errors";
export type FunctionStatistics = "startLatency" | "executionLatency" | "returnLatency";

export type FunctionMetrics = MetricsMap<FunctionCounters, FunctionStatistics>;

export class FunctionMetricsMap extends IncrementalMetricsMap<
    FunctionCounters,
    FunctionStatistics
> {
    getAggregateFunctionStats(): FunctionMetrics {
        return this;
    }

    getIncrementalFunctionStats(): FunctionMetrics {
        return this.incremental;
    }
}

export function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export function streamToBuffer(s: Readable) {
    return new Promise<Buffer>((resolve, reject) => {
        const buffers: Buffer[] = [];
        s.on("error", reject);
        s.on("data", (data: Buffer) => buffers.push(data));
        s.on("end", () => resolve(Buffer.concat(buffers)));
    });
}
