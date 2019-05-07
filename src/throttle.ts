import assert from "assert";
import { sleep } from "./shared";
import { PersistentCache } from "./cache";
import { createHash } from "crypto";
import { FaastError } from "./error";

export class Deferred<T = void> {
    promise: Promise<T>;
    resolve!: (arg: T) => void;
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
    async execute() {
        const cancelMessage = this.cancel && this.cancel();
        if (cancelMessage) {
            this.reject(new FaastError(cancelMessage));
        } else {
            try {
                const rv = await this.worker();
                this.resolve(rv);
            } catch (err) {
                this.reject(err);
            }
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

export type RetryType = number | ((err: any, retries: number) => boolean);

export async function retryOp<T>(retryN: RetryType, fn: (retries: number) => Promise<T>) {
    const retryTest =
        typeof retryN === "function" ? retryN : (_: any, i: number) => i < retryN;
    for (let i = 0; true; i++) {
        try {
            return await fn(i);
        } catch (err) {
            if (!retryTest(err, i)) {
                throw err;
            }
            await sleep(
                Math.min(30 * 1000, 1000 * (1 + Math.random()) * 2 ** i) + Math.random()
            );
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
        const retryWorker = () => retryOp(retryTest, worker);
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

/**
 * @internal
 */
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
                this.push(async () => {
                    try {
                        return await this.worker();
                    } catch (err) {
                        return;
                    } finally {
                        setImmediate(restart);
                    }
                });
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

/**
 * Specify {@link throttle} limits. These limits shape the way throttle invokes
 * the underlying function.
 * @public
 */
export interface Limits {
    /**
     * The maximum number of concurrent executions of the underlying function to
     * allow. Must be supplied, there is no default. Specifying `0` or
     * `Infinity` is allowed and means there is no concurrency limit.
     */
    concurrency: number;
    /**
     * The maximum number of calls per second to allow to the underlying
     * function. Default: no rate limit.
     */
    rate?: number;
    /**
     * The maximum number of calls to the underlying function to "burst" -- e.g.
     * the number that can be issued immediately as long as the rate limit is
     * not exceeded. For example, if rate is 5 and burst is 5, and 10 calls are
     * made to the throttled function, 5 calls are made immediately and then
     * after 1 second, another 5 calls are made immediately. Setting burst to 1
     * means calls are issued uniformly every `1/rate` seconds. If `rate` is not
     * specified, then `burst` does not apply. Default: 1.
     */
    burst?: number;
    /**
     * Retry if the throttled function returns a rejected promise. `retry` can
     * be a number or a function. If it is a number `N`, then up to `N`
     * additional attempts are made in addition to the initial call. If retry is
     * a function, it should return `true` if another retry attempt should be
     * made, otherwise `false`. The first argument will be the value of the
     * rejected promise from the previous call attempt, and the second argument
     * will be the number of previous retry attempts (e.g. the first call will
     * have value 0). Default: 0 (no retry attempts).
     */
    retry?: number | ((err: any, retries: number) => boolean);
    /**
     * If `memoize` is `true`, then every call to the throttled function will be
     * saved as an entry in a map from arguments to return value. If same
     * arguments are seen again in a future call, the return value is retrieved
     * from the Map rather than calling the function again. This can be useful
     * for avoiding redundant calls that are expected to return the same results
     * given the same arguments.
     *
     * The arguments will be captured with `JSON.stringify`, therefore types
     * that do not stringify uniquely won't be distinguished from each other.
     * Care must be taken when specifying `memoize` to ensure avoid incorrect
     * results.
     */
    memoize?: boolean;
    /**
     * Similar to `memoize` except the map from function arguments to results is
     * stored in a persistent cache on disk. This is useful to prevent redundant
     * calls to APIs which are expected to return the same results for the same
     * arguments, and which are likely to be called across many faast.js module
     * instantiations. This is used internally by faast.js for caching cloud
     * prices for AWS and Google, and for saving the last garbage collection
     * date for AWS. Persistent cache entries expire after a period of time. See
     * {@link PersistentCache}.
     */
    cache?: PersistentCache;
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
    cache: PersistentCache,
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

/**
 * A decorator for rate limiting, concurrency limiting, retry, memoization, and
 * on-disk caching. See {@link Limits}.
 * @remarks
 * When programming against cloud services, databases, and other resources, it
 * is often necessary to control the rate of request issuance to avoid
 * overwhelming the service provider. In many cases the provider has built-in
 * safeguards against abuse, which automatically fail requests if they are
 * coming in too fast. Some systems don't have safeguards and precipitously
 * degrade their service level or fail outright when faced with excessive load.
 *
 * With faast.js it becomes very easy to (accidentally) generate requests from
 * thousands of cloud functions. The `throttle` function can help manage request
 * flow without resorting to setting up a separate service. This is in keeping
 * with faast.js' zero-ops philosophy.
 *
 * Usage is simple:
 *
 * ```typescript
 * async function operation() { ... }
 * const throttledOperation = throttle({ concurrency: 10, rate: 5 }, operation);
 * for(let i = 0; i < 100; i++) {
 *     // at most 10 concurrent executions at a rate of 5 invocations per second.
 *     throttledOperation();
 * }
 * ```
 *
 * Note that each invocation to `throttle` creates a separate function with a
 * separate limits. Therefore it is likely that you want to use `throttle` in a
 * global context, not within a dynamic context:
 *
 * ```typescript
 * async function operation() { ... }
 * for(let i = 0; i < 100; i++) {
 *     // WRONG - each iteration creates a separate throttled function that's only called once.
 *     const throttledOperation = throttle({ concurrency: 10, rate: 5 }, operation);
 *     throttledOperation();
 * }
 * ```
 *
 * A better way to use throttle avoids creating a named `operation` function
 * altogether, ensuring it cannot be accidentally called without throttling:
 *
 * ```typescript
 * const operation = throttle({ concurrency: 10, rate: 5 }, async () => {
 *     ...
 * });
 * ```
 *
 * Throttle supports functions with arguments automatically infers the correct
 * type for the returned function:
 *
 * ```typescript
 * // `operation` inferred to have type (str: string) => Promise<string>
 * const operation = throttle({ concurrency: 10, rate: 5 }, async (str: string) => {
 *     return string;
 * });
 * ```
 *
 * In addition to limiting concurrency and invocation rate, `throttle` also
 * supports retrying failed invocations, memoizing calls, and on-disk caching.
 * See {@link Limits} for details.
 *
 * @param fn - The function to throttle. It can take any arguments, but must
 * return a Promise (which includes `async` functions).
 * @public
 */
export function throttle<A extends any[], R>(
    { concurrency, retry, rate, burst, memoize, cache }: Limits,
    fn: (...args: A) => Promise<R>
) {
    const funnel = new Funnel<R>(concurrency, retry);

    let conditionedFunc: (...args: A) => Promise<R>;

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

export class AsyncQueue<T> {
    protected deferred: Array<Deferred<T>> = [];
    protected enqueued: T[] = [];

    enqueue(value: T) {
        if (this.deferred.length > 0) {
            const d = this.deferred.shift();
            d!.resolve(value);
        } else {
            this.enqueued.push(value);
        }
    }

    dequeue(): Promise<T> {
        if (this.enqueued.length > 0) {
            const value = this.enqueued.shift()!;
            return Promise.resolve(value);
        }
        const d = new Deferred<T>();
        this.deferred.push(d);
        return d.promise;
    }

    clear() {
        this.deferred = [];
        this.enqueued = [];
    }
}
