import { sleep } from "./shared";
import { log } from "./log";

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

export class Lock {
    deferred: Deferred<void>[] = [];

    async acquire() {
        const prev = this.deferred[this.deferred.length - 1];
        const next = new Deferred<void>();
        this.deferred.push(next);
        return prev && prev.promise;
    }

    release() {
        const first = this.deferred.shift();
        first && first.resolve();
    }
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
