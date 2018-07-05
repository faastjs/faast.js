import { sleep } from "./shared";
import { log } from "./log";

export class Deferred<T> {
    promise: Promise<T>;
    resolve!: (arg?: any) => void;
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

export async function retry<T>(n: number, fn: () => Promise<T>) {
    for (let i = 1; i < n; i++) {
        try {
            return await fn();
        } catch (err) {
            log(`Retrying ${i}`);
            await sleep((i + Math.random()) * 1000);
        }
    }
    return await fn();
}

export class Funnel<T> {
    protected pendingQueue: Set<Future<T>>;
    protected concurrency: number;

    constructor(public maxConcurrency: number = 0) {
        this.pendingQueue = new Set();
        this.concurrency = 0;
    }

    protected doWork() {
        const { pendingQueue } = this;
        while (
            pendingQueue.size > 0 &&
            (!this.maxConcurrency || this.concurrency < this.maxConcurrency)
        ) {
            const worker = popFirst(pendingQueue)!;
            this.concurrency++;
            worker.promise.catch(_ => {}).then(_ => {
                this.concurrency--;
                this.doWork();
            });
            worker.execute();
        }
    }

    push(worker: () => Promise<T>) {
        const future = new Future(worker);
        this.pendingQueue.add(future);
        this.doWork();
        return future.promise;
    }

    pushRetry(n: number, worker: () => Promise<T>) {
        return this.push(() => retry(n, worker));
    }

    clear() {
        this.pendingQueue.forEach(p =>
            p.reject(new Error("Funnel cleared while promise pending"))
        );
        this.pendingQueue.clear();
    }

    pending() {
        return Array.from(this.pendingQueue.values()).map(p => p.promise);
    }

    setMaxConcurrency(maxConcurrency: number) {
        this.maxConcurrency = maxConcurrency;
    }

    getConcurrency() {
        return this.concurrency;
    }
}

export class Pump<T> extends Funnel<T | void> {
    stopped: boolean = false;
    constructor(maxConcurrency: number, protected worker: () => Promise<T>) {
        super(maxConcurrency);
    }

    start() {
        let restart = () => {
            if (this.stopped) {
                return;
            }
            while (this.concurrency < this.maxConcurrency) {
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

    setMaxConcurrency(concurrency: number) {
        super.setMaxConcurrency(concurrency);
        !this.stopped && this.start();
    }
}
