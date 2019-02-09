export class Statistics {
    samples = 0;
    max = Number.NEGATIVE_INFINITY;
    min = Number.POSITIVE_INFINITY;
    variance = 0;
    stdev = 0;
    mean = NaN;

    constructor(protected printFixedPrecision: number = 1) {}

    // https://math.stackexchange.com/questions/374881/recursive-formula-for-variance
    update(value: number) {
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

export class FactoryMap<K = string, V = {}> extends Map<K, V> {
    constructor(readonly factory: (key: K) => V) {
        super();
    }

    getOrCreate(key: K) {
        let val = this.get(key);
        if (!val) {
            val = this.factory(key);
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

export function sleep(ms: number, cancel = new Promise<void>(() => {})) {
    let id: NodeJS.Timer;
    cancel.then(_ => clearTimeout(id)).catch(_ => clearTimeout(id));
    return Promise.race([new Promise(resolve => (id = setTimeout(resolve, ms))), cancel]);
}

export function streamToBuffer(s: NodeJS.ReadableStream) {
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

export const sum = (a: number[]) => a.reduce((total, n) => total + n, 0);

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

export function hasExpired(date: string | number | undefined, retentionInDays: number) {
    const timestamp = typeof date === "string" ? Date.parse(date) : date || 0;
    return timestamp < Date.now() - retentionInDays * 24 * 60 * 60 * 1000;
}

export function roundTo100ms(n: number) {
    return Math.round(n / 100) * 100;
}

export const uuidv4Pattern =
    "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89aAbB][a-f0-9]{3}-[a-f0-9]{12}";

export const GB = 2 ** 30;
export const MB = 2 ** 20;
export const KB = 2 ** 10;

export function f1(n: number) {
    return n.toFixed(1);
}

export function f2(n: number) {
    return n.toFixed(2);
}

export function keys<K extends string, O extends { [key in K]: any }>(
    obj: O
): Array<keyof O>;
export function keys<O extends object>(obj: O): Array<keyof O> {
    return Object.keys(obj) as Array<keyof O>;
}

export function defined<T>(arg: T | undefined | null | void): arg is T {
    return !!arg;
}

export class Heap {
    protected _heap: number[] = [];

    get size() {
        return this._heap.length;
    }

    peekMin() {
        return this._heap[0];
    }

    insert(value: number) {
        const h = this._heap;
        h.push(value);
        let i = h.length - 1;
        const parentOf = (n: number) => Math.floor((n - 1) / 2);
        let parent = parentOf(i);
        while (parent >= 0 && h[i] < h[parent]) {
            const tmp = h[parent];
            h[parent] = h[i];
            h[i] = tmp;
            i = parent;
            parent = parentOf(i);
        }
    }

    extractMin() {
        const h = this._heap;
        if (h.length === 0) {
            throw new Error("removeMin called on empty heap");
        }
        let i = 0;
        const rv = h[0];
        h[0] = h[h.length - 1];
        h.pop();

        while (i < h.length) {
            const [left, right] = [i * 2 + 1, i * 2 + 2];
            let maybe: number | undefined;
            if (h[i] > h[left] && !(h[right] < h[left])) {
                maybe = left;
            } else if (h[i] > h[right]) {
                maybe = right;
            }
            if (maybe === undefined) {
                break;
            }
            const [iValue, mValue] = [h[i], h[maybe]];
            h[i] = mValue;
            h[maybe] = iValue;
            i = maybe;
        }

        return rv;
    }

    [Symbol.iterator]() {
        return this._heap[Symbol.iterator]();
    }
}

export class LargestN<T = void> {
    protected _heap = new Heap();
    protected _map: [number, T][] = [];

    constructor(readonly size: number) {}

    update(key: number, value: T) {
        if (this._heap.size < this.size) {
            this._heap.insert(key);
            this._map.push([key, value]);
            return;
        }
        if (key <= this._heap.peekMin()) {
            return;
        }
        this._heap.insert(key);
        const min = this._heap.extractMin();
        let idx = this._map.length;
        while (--idx >= 0) {
            if (this._map[idx][0] === min) {
                break;
            }
        }
        if (idx === -1) {
            throw new Error(`LargestN: could not find entry for key ${min}`);
        }
        this._map.splice(idx, 1);
        this._map.push([key, value]);
    }

    [Symbol.iterator]() {
        return this._map[Symbol.iterator]();
    }

    entries() {
        return this._map[Symbol.iterator];
    }

    keys() {
        return [...this._heap];
    }
}
