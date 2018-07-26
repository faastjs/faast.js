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

export class RateLimiter2<T> {
    protected lastTick = 0;
    protected requestsSinceLastTick = 0;
    protected tickParity = false;
    protected queue: Future<T>[] = [];

    constructor(protected maxRequestsPerSecond: number) {
        assert(maxRequestsPerSecond >= 0);
    }

    push(worker: () => Promise<T>) {
        if (
            this.queue.length === 0 &&
            this.requestsSinceLastTick < this.maxTickRequests()
        ) {
            this.incrementRequests();
            return worker();
        }
        const future = new Future(worker);
        this.queue.push(future);
        if (this.queue.length === 1) {
            this.doWorkOnNextTick();
        }
        return future.promise;
    }

    setRateLimit(maxRequestsPerSecond: number) {
        assert(maxRequestsPerSecond >= 0);
        this.maxRequestsPerSecond = maxRequestsPerSecond;
    }

    protected maxTickRequests() {
        return this.tickParity
            ? Math.ceil(this.maxRequestsPerSecond / 2)
            : Math.floor(this.maxRequestsPerSecond / 2);
    }

    protected tick() {
        const now = Date.now();
        if (now - this.lastTick >= 500) {
            this.lastTick = now;
            this.requestsSinceLastTick = 0;
            this.tickParity = !this.tickParity;
        }
    }

    protected incrementRequests() {
        this.tick();
        return ++this.requestsSinceLastTick;
    }

    protected async doWorkOnNextTick() {
        const now = Date.now();
        // Tick every 0.5s and allow 1/2 of the max request rate.
        const msUntilNextTick = 500 - (now - this.lastTick);
        if (msUntilNextTick > 0) {
            await sleep(msUntilNextTick);
        }
        this.tick();
        while (this.requestsSinceLastTick < this.maxTickRequests()) {
            const next = this.queue.shift();
            if (!next) {
                break;
            }
            this.incrementRequests();
            next.execute();
        }
        if (this.queue.length > 0) {
            this.doWorkOnNextTick();
        }
    }
}

export class RateLimiter<T> {
    protected lastSend = 0;
    protected bucket = 0;
    protected queue: Future<T>[] = [];

    constructor(protected maxRequestsPerSecond: number) {
        assert(maxRequestsPerSecond >= 0);
        this.bucket = 0;
    }

    push(worker: () => Promise<T>) {
        this.tick();
        if (this.queue.length === 0 && this.bucket >= 1) {
            this.recordExecute();
            return worker();
        }

        const future = new Future(worker);
        this.queue.push(future);
        if (this.queue.length === 1) {
            this.doWorkOnNextTick();
        }
        return future.promise;
    }

    setRateLimit(maxRequestsPerSecond: number) {
        assert(maxRequestsPerSecond >= 0);
        this.maxRequestsPerSecond = maxRequestsPerSecond;
    }

    protected recordExecute() {
        this.bucket--;
        this.lastSend = Date.now();
    }

    protected tick() {
        const now = Date.now();
        this.bucket += ((now - this.lastSend) / 1000) * this.maxRequestsPerSecond;
        log(`Bucket: ${this.bucket}`);
        this.bucket = Math.min(this.bucket, this.maxRequestsPerSecond);
        log(`Bucket: ${this.bucket}`);
    }

    protected async doWorkOnNextTick() {
        const msUntilNextTick = Math.floor(1000 / this.maxRequestsPerSecond);
        if (msUntilNextTick > 0) {
            await sleep(msUntilNextTick);
        }
        this.tick();
        while (this.bucket >= 1) {
            const next = this.queue.shift();
            if (!next) {
                break;
            }
            this.recordExecute();
            next.execute();
        }
        if (this.queue.length > 0) {
            this.doWorkOnNextTick();
        }
    }
}

export class RateLimitedFunnel<T> {
    protected funnel: Funnel<T>;
    protected rateLimiter: RateLimiter<T>;

    constructor({
        maxConcurrency,
        maxRequestsPerSecond
    }: {
        maxConcurrency: number;
        maxRequestsPerSecond: number;
    }) {
        this.funnel = new Funnel<T>(maxConcurrency);
        this.rateLimiter = new RateLimiter<T>(maxRequestsPerSecond);
    }

    setMaxConcurrency(maxConcurrency: number) {
        this.funnel.setMaxConcurrency(maxConcurrency);
    }

    setRateLimit(maxRequestsPerSecond: number) {
        this.rateLimiter.setRateLimit(maxRequestsPerSecond);
    }

    push(worker: () => Promise<T>) {
        return this.funnel.push(() => this.rateLimiter.push(worker));
    }
}
