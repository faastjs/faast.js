import * as assert from "assert";
import { sleep } from "./shared";

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

export class Future<T = void> extends Deferred<T> {
    constructor(private fn: () => Promise<T>, private cancel?: () => string | undefined) {
        super();
    }
    execute(): void {
        const cancelMessage = this.cancel && this.cancel();
        if (cancelMessage) {
            this.reject(new Error(cancelMessage));
        } else {
            this.fn()
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

export async function retry<T, E>(
    shouldRetry: number | ((err: E, retries: number) => boolean),
    fn: (retries: number) => Promise<T>
) {
    const retryTest =
        typeof shouldRetry === "function"
            ? shouldRetry
            : (_: any, i: number) => i < shouldRetry;
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
    protected pendingQueue: Set<Future<T>> = new Set();
    protected executingQueue: Set<Future<T>> = new Set();

    constructor(public maxConcurrency: number = 0) {}

    push(worker: () => Promise<T>, cancel?: () => string | undefined) {
        const future = new Future(worker, cancel);
        this.pendingQueue.add(future);
        this.doWork();
        return future.promise;
    }

    pushRetry<E>(
        shouldRetry: number | ((err: E, retries: number) => boolean),
        worker: (retries: number) => Promise<T>
    ) {
        return this.push(() => retry(shouldRetry, worker));
    }

    clear(msg: string = "Execution cancelled by funnel clearing") {
        this.pendingQueue.forEach(p => p.reject(new Error(msg)));
        this.pendingQueue.clear();
        this.executingQueue.forEach(p => p.reject(new Error(msg)));
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
        return this.all();
    }

    setMaxConcurrency(concurrency: number) {
        super.setMaxConcurrency(concurrency);
        if (!this.stopped) {
            this.start();
        }
    }
}

export class MemoFunnel<A, T = void> extends Funnel<T> {
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

export class RateLimiter<T = void> {
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

    push(worker: () => Promise<T>, cancel?: () => string | undefined) {
        this.updateBucket();
        if (this.queue.size === 0 && this.bucket <= this.maxBurst - 1) {
            this.bucket++;
            return worker();
        }

        const future = new Future(worker, cancel);
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

interface Limits {
    maxConcurrency: number;
    targetRequestsPerSecond: number;
    maxBurst?: number;
}

export class RateLimitedFunnel<T = void> extends Funnel<T> {
    protected rateLimiter: RateLimiter<T>;

    constructor({ maxConcurrency, targetRequestsPerSecond, maxBurst }: Limits) {
        super(maxConcurrency);
        this.rateLimiter = new RateLimiter<T>(targetRequestsPerSecond, maxBurst);
    }

    setRateLimit(maxRequestsPerSecond: number) {
        this.rateLimiter.setTargetRateLimit(maxRequestsPerSecond);
    }

    push(worker: () => Promise<T>, cancel?: () => string | undefined) {
        return super.push(() => this.rateLimiter.push(worker, cancel), cancel);
    }

    pushRetry<E>(
        shouldRetry: number | ((err: E, retries: number) => boolean),
        worker: (retries: number) => Promise<T>
    ) {
        return super.pushRetry(shouldRetry, retries =>
            this.rateLimiter.push(() => worker(retries))
        );
    }
}
