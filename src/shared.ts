import { Readable } from "stream";

export class Statistics {
    samples = 0;
    max = Number.NEGATIVE_INFINITY;
    min = Number.POSITIVE_INFINITY;
    variance = NaN;
    stdev = NaN;
    mean = NaN;

    constructor(protected printFixedPrecision: number = 1) {}

    // https://math.stackexchange.com/questions/374881/recursive-formula-for-variance
    update(value: number | undefined) {
        if (value === undefined) {
            return;
        }
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
        return `${this.mean.toFixed(this.printFixedPrecision)}`;
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

export class ExponentiallyDecayingAverageValue {
    samples = 0;
    value = 0;
    constructor(public smoothingFactor: number) {}
    update(n: number) {
        // tslint:disable-next-line:prefer-conditional-expression
        if (this.samples++ === 0) {
            this.value = n;
        } else {
            this.value =
                this.smoothingFactor * n + (1 - this.smoothingFactor) * this.value;
        }
    }
    toString() {
        return this.value;
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

export function chomp(s: string) {
    if (s.length > 0 && s[s.length - 1] === "\n") {
        s = s.slice(0, s.length - 1);
    }
    return s;
}

export function assertNever(x: never): never {
    throw new Error("Unexpected object: " + x);
}

export function sum(numbers: number[]) {
    return numbers.reduce((a, b) => a + b, 0);
}

export function objectSize(obj?: { [key: string]: string }) {
    if (!obj) {
        return 0;
    }
    return sum(Object.keys(obj).map(key => key.length + obj[key].length));
}

export function computeHttpResponseBytes(
    headers: { [key: string]: string },
    opts = { httpHeaders: true, min: 0 }
) {
    const headerKeys = Object.keys(headers);
    let contentLength = 0;
    for (const key of headerKeys) {
        if (key.match(/^content-length$/i)) {
            contentLength = Number(headers[key]);
            break;
        }
    }
    if (!opts.httpHeaders) {
        return Math.max(contentLength, opts.min);
    }
    const headerLength = objectSize(headers) + headerKeys.length * ": ".length;
    const otherLength = 13;
    return Math.max(contentLength + headerLength + otherLength, opts.min);
}

export class LogStitcher {
    lastLogEventTime = 0;
    seenIds = new Set<string>();

    updateEvent(timestamp: number | undefined, eventId: string | undefined) {
        if (timestamp) {
            if (timestamp > this.lastLogEventTime) {
                this.lastLogEventTime = timestamp;
                this.seenIds.clear();
            }
            if (eventId && timestamp === this.lastLogEventTime) {
                this.seenIds.add(eventId);
            }
        }
    }

    updateEvents<T>(
        entries: T[],
        getTimestamp: (event: T) => number | undefined,
        getId: (event: T) => string | undefined
    ) {
        if (entries.length > 0) {
            const last = entries[entries.length - 1];
            this.updateEvent(getTimestamp(last), getId(last));
            for (const entry of entries) {
                this.updateEvent(getTimestamp(entry), getId(entry));
            }
        }
    }

    has(id: string | undefined) {
        return typeof id === "string" && this.seenIds.has(id);
    }
}

export function hasExpired(date: string | number | undefined, retentionInDays: number) {
    const timestamp = typeof date === "string" ? Date.parse(date) : date || 0;
    return timestamp < Date.now() - retentionInDays * 24 * 60 * 60 * 1000;
}
