import * as assert from "assert";
import { sleep } from "./shared";
import { PromiseFn, Fn } from "./types";
import { LocalCache } from "./cache";
import { createHash } from "crypto";

export class Deferred<T = void> {
    promise: Promise<T>;
    resolve!: (arg?: T) => void;
    reject!: (err?: any) => void;
    constructor() {
        this.promise = new Promise<T>((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}

export class DeferredWorker<T = void> extends Deferred<T> {
    constructor(
        private worker: () => Promise<T>,
        private cancel?: () => string | undefined
    ) {
        super();
    }
    execute(): void {
        const cancelMessage = this.cancel && this.cancel();
        if (cancelMessage) {
            this.reject(new Error(cancelMessage));
        } else {
            this.worker()
                .then(x => this.resolve(x))
                .catch(err => this.reject(err));
        }
    }
}

function popFirst<T>(set: Set<T>): T | undefined {
    let firstElem: T | undefined;
    for (const elem of set) {
        firstElem = elem;
        break;
    }
    if (firstElem) {
        set.delete(firstElem);
    }
    return firstElem;
}

type RetryType = number | ((err: any, retries: number) => boolean);

export async function retry<T>(retryN: RetryType, fn: (retries: number) => Promise<T>) {
    const retryTest =
        typeof retryN === "function" ? retryN : (_: any, i: number) => i < retryN;
    for (let i = 0; true; i++) {
        try {
            return await fn(i);
        } catch (err) {
            if (!retryTest(err, i)) {
                throw err;
            }
            await sleep(Math.min(30 * 1000, 1000 * 2 ** i) + Math.random());
        }
    }
}

export class Funnel<T = void> {
    protected pendingQueue: Set<DeferredWorker<T>> = new Set();
    protected executingQueue: Set<DeferredWorker<T>> = new Set();
    public processed = 0;
    public errors = 0;

    constructor(public concurrency: number = 0, protected shouldRetry?: RetryType) {}

    push(
        worker: () => Promise<T>,
        shouldRetry?: RetryType,
        cancel?: () => string | undefined
    ) {
        const retryTest = shouldRetry || this.shouldRetry || 0;
        const retryWorker = () => retry(retryTest, worker);
        const future = new DeferredWorker(retryWorker, cancel);
        this.pendingQueue.add(future);
        setImmediate(() => this.doWork());
        return future.promise;
    }

    clear() {
        this.pendingQueue.clear();
        this.executingQueue.clear();
    }

    promises() {
        return [...this.executingQueue, ...this.pendingQueue].map(p => p.promise);
    }

    all() {
        return Promise.all(this.promises().map(p => p.catch(_ => {})));
    }

    size() {
        return this.pendingQueue.size + this.executingQueue.size;
    }

    setMaxConcurrency(maxConcurrency: number) {
        this.concurrency = maxConcurrency;
    }

    getConcurrency() {
        return this.executingQueue.size;
    }

    protected doWork() {
        const { pendingQueue } = this;
        while (
            pendingQueue.size > 0 &&
            (!this.concurrency || this.executingQueue.size < this.concurrency)
        ) {
            const worker = popFirst(pendingQueue)!;
            this.executingQueue.add(worker);
            worker.promise
                .then(_ => this.processed++)
                .catch(_ => this.errors++)
                .then(_ => {
                    this.executingQueue.delete(worker);
                    this.doWork();
                });
            worker.execute();
        }
    }
}

export class Pump<T = void> extends Funnel<T | void> {
    stopped: boolean = false;
    constructor(maxConcurrency: number, protected worker: () => Promise<T>) {
        super(maxConcurrency);
    }

    start() {
        const restart = () => {
            if (this.stopped) {
                return;
            }
            while (this.executingQueue.size + this.pendingQueue.size < this.concurrency) {
                this.push(() =>
                    this.worker()
                        .catch(_ => {})
                        .then(x => {
                            setImmediate(restart);
                            return x;
                        })
                );
            }
        };
        this.stopped = false;
        restart();
    }

    stop() {
        this.stopped = true;
    }

    drain() {
        this.stop();
        return this.all();
    }

    setMaxConcurrency(concurrency: number) {
        super.setMaxConcurrency(concurrency);
        if (!this.stopped) {
            this.start();
        }
    }
}

export class RateLimiter<T = void> {
    protected lastTick = 0;
    protected bucket = 0;
    protected queue: Set<DeferredWorker<T>> = new Set();

    constructor(protected targetRequestsPerSecond: number, protected burst: number = 1) {
        assert(targetRequestsPerSecond > 0);
        assert(this.burst >= 1);
    }

    push(worker: () => Promise<T>, cancel?: () => string | undefined) {
        this.updateBucket();
        if (this.queue.size === 0 && this.bucket <= this.burst - 1) {
            this.bucket++;
            return worker();
        }

        const future = new DeferredWorker(worker, cancel);
        this.queue.add(future);
        if (this.queue.size === 1) {
            this.drainQueue();
        }
        return future.promise;
    }

    protected updateBucket() {
        const now = Date.now();
        const secondsElapsed = (now - this.lastTick) / 1000;
        this.bucket -= secondsElapsed * this.targetRequestsPerSecond;
        this.bucket = Math.max(this.bucket, 0);
        this.lastTick = now;
    }

    protected async drainQueue() {
        const requestAmountToDrain = 1 - (this.burst - this.bucket);
        const secondsToDrain = requestAmountToDrain / this.targetRequestsPerSecond;
        if (secondsToDrain > 0) {
            await sleep(Math.ceil(secondsToDrain * 1000));
        }
        this.updateBucket();
        while (this.bucket <= this.burst - 1) {
            const next = popFirst(this.queue);
            if (!next) {
                break;
            }
            this.bucket++;
            next.execute();
        }
        if (this.queue.size > 0) {
            this.drainQueue();
        }
    }
}

interface Limits {
    concurrency: number;
    rate?: number;
    burst?: number;
    retry?: number | ((err: any, retries: number) => boolean);
    memoize?: boolean;
    cache?: LocalCache;
}

export function memoizeFn<A extends any[], R>(fn: (...args: A) => R) {
    const cache = new Map<string, R>();
    return (...args: A) => {
        const key = JSON.stringify(args);
        const prev = cache.get(key);
        if (prev) {
            return prev;
        }
        const value = fn(...args);
        cache.set(key, value);
        return value;
    };
}

export function cacheFn<A extends any[], R>(
    cache: LocalCache,
    fn: (...args: A) => Promise<R>
) {
    return async (...args: A) => {
        const key = JSON.stringify(args);

        const hasher = createHash("sha256");
        hasher.update(key);
        const cacheKey = hasher.digest("hex");

        const prev = await cache.get(cacheKey);
        if (prev) {
            const str = prev.toString();
            if (str === "undefined") {
                return undefined;
            }
            return JSON.parse(str);
        }
        const value = await fn(...args);
        await cache.set(cacheKey, JSON.stringify(value));
        return value;
    };
}

export function throttle<A extends any[], R>(
    { concurrency, retry: retryN, rate, burst, memoize, cache }: Limits,
    fn: PromiseFn<A, R>
) {
    const funnel = new Funnel<R>(concurrency, retryN);

    let conditionedFunc: PromiseFn<A, R>;

    if (rate) {
        const rateLimiter = new RateLimiter<R>(rate, burst);
        conditionedFunc = (...args: A) =>
            funnel.push(() => rateLimiter.push(() => fn(...args)));
    } else {
        conditionedFunc = (...args: A) => funnel.push(() => fn(...args));
    }

    if (cache) {
        conditionedFunc = cacheFn(cache, conditionedFunc);
    }
    if (memoize) {
        conditionedFunc = memoizeFn(conditionedFunc);
    }
    return conditionedFunc;
}
