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

export class Funnel {
    protected pendingQueue: Set<Future<any>>;
    protected concurrency: number;

    constructor(protected maxConcurrency: number = 0) {
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

    push<T>(worker: () => Promise<T>) {
        const future = new Future(worker);
        this.pendingQueue.add(future);
        this.doWork();
        return future.promise;
    }

    pushRetry<T>(n: number, worker: () => Promise<T>) {
        return this.push(() => retry(n, worker));
    }

    clear() {
        this.pendingQueue.forEach(p =>
            p.reject(new Error("Funnel cleared while promise pending"))
        );
        this.pendingQueue.clear();
    }

    setMaxConcurrency(maxConcurrency: number) {
        this.maxConcurrency = maxConcurrency;
    }

    getConcurrency() {
        return this.concurrency;
    }
}

export class AutoFunnel<T> extends Funnel {
    constructor(protected worker: () => Promise<T>, maxConcurrency: number = 0) {
        super(maxConcurrency);
    }

    fill(nWorkers: number) {
        const promises: Promise<T>[] = [];
        if (this.maxConcurrency > 0 && nWorkers > this.maxConcurrency) {
            nWorkers = this.maxConcurrency;
        }
        while (this.concurrency < nWorkers) {
            promises.push(this.push(this.worker));
        }
        return promises;
    }
}

export class Pump<T> extends Funnel {
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
                        .then(_ => setTimeout(() => restart(), 0))
                );
            }
        };
        this.stopped = false;
        restart();
    }

    stop() {
        this.stopped = true;
        this.clear();
    }
}
