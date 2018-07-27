import { sleep } from "./shared";
import { log } from "./log";
import * as assert from "assert";

export class Deferred<T> {
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

export class Future<T> extends Deferred<T> {
    constructor(private fn: () => Promise<T>) {
        super();
    }
    execute(): void {
        this.fn()
            .then(x => this.resolve(x))
            .catch(err => this.reject(err));
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

export async function retry<T>(n: number, fn: (retries: number) => Promise<T>) {
    for (let i = 1; i < n; i++) {
        try {
            return await fn(i - 1);
        } catch (err) {
            await sleep((i + Math.random()) * 1000);
        }
    }
    return fn(n - 1);
}

export class Funnel<T> {
    protected pendingQueue: Set<Future<T>> = new Set();
    protected executingQueue: Set<Future<T>> = new Set();

    constructor(public maxConcurrency: number = 0) {}

    push(worker: () => Promise<T>) {
        const future = new Future(worker);
        this.pendingQueue.add(future);
        this.doWork();
        return future.promise;
    }

    pushRetry(n: number, worker: (retries: number) => Promise<T>) {
        return this.push(() => retry(n, worker));
    }

    clearPending() {
        this.pendingQueue.clear();
    }

    pendingFutures() {
        return Array.from(this.pendingQueue.values());
    }

    pending() {
        return this.pendingFutures().map(p => p.promise);
    }

    executingFutures() {
        return Array.from(this.executingQueue.values());
    }

    executing() {
        return this.executingFutures().map(p => p.promise);
    }

    allFutures() {
        return [...this.pendingFutures(), ...this.executingFutures()];
    }

    all() {
        return this.allFutures().map(p => p.promise);
    }

    setMaxConcurrency(maxConcurrency: number) {
        this.maxConcurrency = maxConcurrency;
    }

    getConcurrency() {
        return this.executingQueue.size;
    }

    protected doWork() {
        const { pendingQueue } = this;
        while (
            pendingQueue.size > 0 &&
            (!this.maxConcurrency || this.executingQueue.size < this.maxConcurrency)
        ) {
            const worker = popFirst(pendingQueue)!;
            this.executingQueue.add(worker);
            worker.promise.catch(_ => {}).then(_ => {
                this.executingQueue.delete(worker);
                this.doWork();
            });
            worker.execute();
        }
    }
}

export class Pump<T> extends Funnel<T | void> {
    stopped: boolean = false;
    constructor(maxConcurrency: number, protected worker: () => Promise<T>) {
        super(maxConcurrency);
    }

    start() {
        const restart = () => {
            if (this.stopped) {
                return;
            }
            while (this.executingQueue.size < this.maxConcurrency) {
                this.push(() =>
                    this.worker()
                        .catch(_ => {})
                        .then(x => {
                            setTimeout(() => restart(), 0);
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
        return Promise.all(this.executing());
    }

    setMaxConcurrency(concurrency: number) {
        super.setMaxConcurrency(concurrency);
        if (!this.stopped) {
            this.start();
        }
    }
}

export class MemoFunnel<A, T> extends Funnel<T> {
    memoized: Map<A, T> = new Map();
    constructor(public maxConcurrency: number) {
        super(maxConcurrency);
    }

    async pushMemoized(key: A, worker: () => Promise<T>) {
        const prev = this.memoized.get(key);
        if (prev) {
            return prev;
        }
        return super.push(this.memoizeWorker(key, worker));
    }

    async pushMemoizedRetry(n: number, key: A, worker: () => Promise<T>) {
        const prev = this.memoized.get(key);
        if (prev) {
            return prev;
        }
        return super.push(() => retry(n, this.memoizeWorker(key, worker)));
    }

    protected memoizeWorker(key: A, worker: () => Promise<T>) {
        return async () => {
            const prev = this.memoized.get(key);
            if (prev) {
                return prev;
            }
            const value = await worker();
            this.memoized.set(key, value);
            return value;
        };
    }
}

export class RateLimiter<T> {
    protected lastTick = 0;
    protected bucket = 0;
    protected queue: Set<Future<T>> = new Set();

    constructor(
        protected targetRequestsPerSecond: number,
        protected maxBurst: number = 1
    ) {
        assert(targetRequestsPerSecond > 0);
        assert(this.maxBurst >= 1);
    }

    push(worker: () => Promise<T>) {
        this.updateBucket();
        if (this.queue.size === 0 && this.bucket <= this.maxBurst - 1) {
            this.bucket++;
            return worker();
        }

        const future = new Future(worker);
        this.queue.add(future);
        if (this.queue.size === 1) {
            this.drainQueue();
        }
        return future.promise;
    }

    setTargetRateLimit(targetRequestsPerSecond: number) {
        assert(targetRequestsPerSecond > 0);
        this.targetRequestsPerSecond = targetRequestsPerSecond;
    }

    setBurstMax(maxBurst: number) {
        assert(maxBurst >= 1);
        this.maxBurst = maxBurst;
    }

    protected updateBucket() {
        const now = Date.now();
        const secondsElapsed = (now - this.lastTick) / 1000;
        this.bucket -= secondsElapsed * this.targetRequestsPerSecond;
        this.bucket = Math.max(this.bucket, 0);
        this.lastTick = now;
    }

    protected async drainQueue() {
        const requestAmountToDrain = 1 - (this.maxBurst - this.bucket);
        const secondsToDrain = requestAmountToDrain / this.targetRequestsPerSecond;
        if (secondsToDrain > 0) {
            await sleep(secondsToDrain * 1000);
        }
        this.updateBucket();
        while (this.bucket <= this.maxBurst - 1) {
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

export class RateLimitedFunnel<T> {
    protected funnel: Funnel<T>;
    protected rateLimiter: RateLimiter<T>;

    constructor({
        maxConcurrency,
        targetRequestsPerSecond,
        maxBurst
    }: {
        maxConcurrency: number;
        targetRequestsPerSecond: number;
        maxBurst?: number;
    }) {
        this.funnel = new Funnel<T>(maxConcurrency);
        this.rateLimiter = new RateLimiter<T>(targetRequestsPerSecond, maxBurst);
    }

    setMaxConcurrency(maxConcurrency: number) {
        this.funnel.setMaxConcurrency(maxConcurrency);
    }

    setRateLimit(maxRequestsPerSecond: number) {
        this.rateLimiter.setTargetRateLimit(maxRequestsPerSecond);
    }

    push(worker: () => Promise<T>) {
        return this.funnel.push(() => this.rateLimiter.push(worker));
    }
}
