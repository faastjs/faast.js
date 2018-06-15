import { AnyFunction } from "./cloudify";

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

export class Funnel {
    protected pendingQueue: Set<Future<any>>;
    protected concurrency: number;

    constructor(protected maxConcurrency: number = 0) {
        this.pendingQueue = new Set();
        this.concurrency = 0;
    }

    protected async doWork() {
        const { pendingQueue } = this;
        while (
            pendingQueue.size > 0 &&
            (!this.maxConcurrency || this.concurrency < this.maxConcurrency)
        ) {
            const worker = popFirst(pendingQueue)!;
            this.concurrency++;
            worker.promise.then(_ => {
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
