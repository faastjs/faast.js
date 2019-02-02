import { sleep } from "../src/shared";
import {
    Deferred,
    Funnel,
    Pump,
    RateLimiter,
    retry,
    throttle,
    cacheFn,
    AsyncQueue
} from "../src/throttle";
import { timer, Timing } from "./functions";
import { LocalCache } from "../src/cache";
import * as uuidv4 from "uuid/v4";
import { measureConcurrency } from "./util";
import test from "ava";

test("deferred resolves its promise", async t => {
    const deferred = new Deferred();
    let resolved = false;
    deferred.promise.then(_ => (resolved = true));
    t.is(resolved, false);
    deferred.resolve();
    await deferred.promise;
    t.is(resolved, true);
});

test("deferred rejects its promise", async t => {
    const deferred = new Deferred();
    let rejected = false;
    t.is(rejected, false);
    deferred.reject();
    try {
        await deferred.promise;
    } catch (_) {
        rejected = true;
    }
    t.is(rejected, true);
});
test("deferred resolves only once", async t => {
    const deferred = new Deferred();
    let value = 0;
    deferred.promise.then(_ => value++);

    deferred.resolve();
    await deferred.promise;
    t.is(value, 1);

    deferred.resolve();
    await deferred.promise;
    t.is(value, 1);
});
test("deferred cannot reject after resolving", async t => {
    const deferred = new Deferred();
    let value = 0;
    deferred.promise.then(_ => value++);

    deferred.resolve();
    await deferred.promise;
    t.is(value, 1);

    deferred.reject();
    await deferred.promise;
    t.is(value, 1);
});

test("funnel defaults to infinite concurrency (tested with 200)", async t => {
    const funnel = new Funnel<Timing>(0);
    const promises = [];
    const N = 200;
    for (let i = 0; i < N; i++) {
        promises.push(funnel.push(() => timer(300)));
    }
    const times = await Promise.all(promises);
    t.is(measureConcurrency(times), N);
});

test("funnel single concurrency is mutually exclusive", async t => {
    const funnel = new Funnel<Timing>(1);
    const promises = [];
    const N = 10;
    for (let i = 0; i < N; i++) {
        promises.push(funnel.push(() => timer(10)));
    }
    const times = await Promise.all(promises);
    t.is(measureConcurrency(times), 1);
});
test("funnel handles concurrency level 2", async t => {
    const funnel = new Funnel<Timing>(2);
    const promises = [];
    const N = 10;
    for (let i = 0; i < N; i++) {
        promises.push(funnel.push(() => timer(20)));
    }
    const times = await Promise.all(promises);
    t.is(measureConcurrency(times), 2);
});
test("funnel handles concurrency level 10", async t => {
    const funnel = new Funnel<Timing>(10);
    const promises = [];
    const N = 100;
    for (let i = 0; i < N; i++) {
        promises.push(funnel.push(() => timer(20)));
    }
    const times = await Promise.all(promises);
    t.is(measureConcurrency(times), 10);
});
test("funnel resumes after finishing a worker", async t => {
    const funnel = new Funnel<Timing>(1);
    const time1 = await funnel.push(() => timer(10));
    const time2 = await funnel.push(() => timer(10));
    t.is(measureConcurrency([time1, time2]), 1);
});
test("funnel clearing", async t => {
    const funnel = new Funnel<number>(1);
    let count = 0;
    const promise0 = funnel.push(async () => count++);
    const promise1 = funnel.push(async () => count++);
    const promise2 = funnel.push(async () => count++);
    funnel.clear();
    t.is(
        await Promise.race([promise0, promise1, promise2, sleep(100).then(_ => "done")]),
        "done"
    );
    t.is(count, 0);
});
test("funnel gets executed asynchronously, not at the moment of push", async t => {
    const funnel = new Funnel(1);
    let n = 0;
    funnel.push(async () => {
        n++;
    });
    t.is(n, 0);
    await funnel.all();
    t.is(n, 1);
});
test("funnel handles promise rejections without losing concurrency", async t => {
    const funnel = new Funnel<void>(1);
    let executed = false;
    await t.throwsAsync(funnel.push(() => Promise.reject("message")), "message");
    await funnel.push(async () => {
        executed = true;
    });
    t.is(executed, true);
});
test("funnel.all() waits for all requests to finish", async t => {
    const funnel = new Funnel<string>(1);
    let executed = false;
    funnel.push(async () => {
        await sleep(200);
        executed = true;
        return "first";
    });
    funnel.push(async () => "second");
    t.is(executed, false);
    const result = await funnel.all();
    t.is(result.length, 2);
    t.is(result[0], "first");
    t.is(result[1], "second");
    t.is(executed, true);
});
test("funnel.all() ignores errors and waits for other requests to finish", async t => {
    const funnel = new Funnel<string>(1);
    funnel.push(async () => {
        throw new Error();
    });
    funnel.push(async () => {
        await sleep(100);
        return "done";
    });
    const result = await funnel.all();
    t.is(result.length, 2);
    t.falsy(result[0]);
    t.is(result[1], "done");
});

test("funnel retry() retries failures", async t => {
    let attempts = 0;
    await retry(2, async () => {
        attempts++;
        throw new Error();
    }).catch(_ => {});
    t.is(attempts, 3);
});

test("funnel shouldRetry parameter retries failures", async t => {
    const funnel = new Funnel<string>(1, 2);
    let attempts = 0;
    let errors = 0;
    funnel
        .push(async () => {
            attempts++;
            throw Error();
        })
        .catch(_ => errors++);
    await funnel.all();
    t.is(attempts, 3);
    t.is(errors, 1);
});

test("funnel cancellation", async t => {
    const funnel = new Funnel(1);
    let executed = 0;

    const promise = funnel.push(
        async () => {
            executed++;
        },
        0,
        () => "cancelled"
    );
    await t.throwsAsync(promise);
    t.is(executed, 0);
});

test("funnel processed and error counts", async t => {
    const funnel = new Funnel(2);
    funnel.push(async () => {});
    funnel.push(async () => Promise.reject());
    funnel.push(async () => {});
    funnel.push(async () => Promise.reject());
    funnel.push(async () => {});

    await funnel.all();
    t.is(funnel.processed, 3);
    t.is(funnel.errors, 2);
});

test("pump works for concurrency level 1", async t => {
    let executed = 0;
    const pump = new Pump(1, () => {
        executed++;
        return sleep(100);
    });
    t.is(executed, 0);
    pump.start();
    await sleep(300);
    pump.stop();
    t.true(executed > 1);
});

test("pump works for concurrency level 10", async t => {
    let executed = 0;
    const pump = new Pump(10, () => {
        executed++;
        return sleep(100);
    });
    pump.start();
    await sleep(100);
    pump.stop();
    t.is(executed, 10);
});

test("pump handles promise rejections without losing concurrency", async t => {
    let executed = 0;
    const pump = new Pump(1, () => {
        executed++;
        return sleep(100).then(_ => Promise.reject("hi"));
    });
    pump.start();
    await sleep(500);
    pump.stop();
    t.is(executed, 5);
});

test("pump drain", async t => {
    let started = 0;
    let finished = 0;
    const N = 5;

    const pump = new Pump(N, async () => {
        started++;
        await sleep(100);
        finished++;
    });

    t.is(started, 0);
    t.is(finished, 0);

    pump.start();
    await pump.drain();
    t.is(started, N);
    t.is(finished, N);
});

test("memoize returns cached results for the same key", async t => {
    const promises = [];
    const N = 10;
    const timerFn = throttle({ memoize: true, concurrency: 1, rate: 10 }, _ => timer(10));
    for (let i = 0; i < N; i++) {
        promises.push(timerFn("key"));
    }
    const times = await Promise.all(promises);
    t.is(measureConcurrency(times), N);
});
test("memoize runs the worker for different keys", async t => {
    const promises = [];
    const N = 10;
    const timerFn = throttle({ memoize: true, concurrency: 1, rate: 10 }, _ => timer(10));
    for (let i = 0; i < N; i++) {
        promises.push(timerFn(i));
    }
    const times = await Promise.all(promises);
    t.is(measureConcurrency(times), 1);
});

async function withCache(fn: (cache: LocalCache) => Promise<void>) {
    const nonce = uuidv4();
    const cache = new LocalCache(`.faast/test/${nonce}`);
    await fn(cache).catch(console.error);
    await cache.clear({ leaveEmptyDir: false });
}

test("caching saves values and skips re-execution", t =>
    withCache(async cache => {
        let counter = 0;
        function fn(_: number) {
            return Promise.resolve(counter++);
        }
        const mfn = cacheFn(cache, fn);
        await mfn(0);
        await mfn(7);
        await mfn(0);
        t.is(counter, 2);

        const mfn2 = cacheFn(cache, fn);
        await mfn2(0);
        await mfn2(7);
        await mfn2(0);
        await mfn2(10);
        t.is(counter, 3);
    }));

test("cache works with string arguments", async t =>
    withCache(async cache => {
        let counter = 0;
        function fn(_: string) {
            return Promise.resolve(counter++);
        }
        const mfn = cacheFn(cache, fn);
        await mfn("a");
        await mfn("b");
        await mfn("a");
        t.is(counter, 2);
    }));

test("cache works with object arguments", async t =>
    withCache(async cache => {
        let counter = 0;
        function fn(_: { f: string; i: number }) {
            return Promise.resolve(counter++);
        }
        const mfn = cacheFn(cache, fn);
        await mfn({ f: "field", i: 42 });
        await mfn({ f: "field", i: 1 });
        await mfn({ f: "other", i: 42 });
        await mfn({ f: "field", i: 42 });
        t.is(counter, 3);
    }));

test("cache does not save rejected promises from cached function", async t =>
    withCache(async cache => {
        let counter = 0;
        function fn(_: number) {
            counter++;
            return Promise.reject(new Error("rejection"));
        }
        let caught = 0;
        const mfn = cacheFn(cache, fn);
        await mfn(1).catch(_ => caught++);
        await mfn(2).catch(_ => caught++);
        await mfn(1).catch(_ => caught++);
        t.is(counter, 3);
        t.is(caught, 3);
    }));

function measureMaxRequestRatePerSecond(timings: Timing[]) {
    const requestsPerSecondStartingAt = timings
        .map(t => t.start)
        .map(t => timings.filter(({ start }) => start >= t && start < t + 1000).length);
    return Math.max(...requestsPerSecondStartingAt);
}

test("rate limiter restricts max request rate per second", async t => {
    const requestRate = 10;
    const rateLimiter = new RateLimiter<Timing>(requestRate);
    const promises: Promise<Timing>[] = [];
    for (let i = 0; i < 15; i++) {
        promises.push(rateLimiter.push(() => timer(0)));
    }
    const timings = await Promise.all(promises);
    t.is(measureMaxRequestRatePerSecond(timings), requestRate);
});

test("rate limiter works across second boundaries", async t => {
    const requestRate = 10;
    const rateLimiter = new RateLimiter<Timing>(requestRate);
    const promises: Promise<Timing>[] = [];
    promises.push(rateLimiter.push(() => timer(0)));
    await sleep(900);
    for (let i = 0; i < 15; i++) {
        promises.push(rateLimiter.push(() => timer(0)));
    }
    const timings = await Promise.all(promises);
    t.is(measureMaxRequestRatePerSecond(timings), requestRate);
});

test("rate limiter bursting allows for request rate beyond target rate", async t => {
    const requestRate = 10;
    const maxBurst = 5;
    const rateLimiter = new RateLimiter<Timing>(requestRate, maxBurst);
    const promises: Promise<Timing>[] = [];
    for (let i = 0; i < 15; i++) {
        promises.push(rateLimiter.push(() => timer(0)));
    }
    const timings = await Promise.all(promises);
    const maxRate = measureMaxRequestRatePerSecond(timings);
    t.true(maxRate <= maxBurst + requestRate);
    t.true(maxRate > maxBurst);
});

test("throttle limits max concurrency and rate", async t => {
    const concurrency = 10;
    const rate = 10;
    const timerFn = throttle({ concurrency, rate }, timer);
    const promises = [];
    for (let i = 0; i < 15; i++) {
        promises.push(timerFn(1000));
    }

    const times = await Promise.all(promises);
    t.is(measureConcurrency(times), concurrency);
    t.is(measureMaxRequestRatePerSecond(times), rate);
});

test("throttle limits rate with single concurrency", async t => {
    const concurrency = 1;
    const rate = 10;
    const processTimeMs = 200;
    const timerFn = throttle({ concurrency, rate }, timer);

    const promises = [];
    for (let i = 0; i < 10; i++) {
        promises.push(timerFn(processTimeMs));
    }

    const times = await Promise.all(promises);
    t.is(measureConcurrency(times), concurrency);
    t.is(measureMaxRequestRatePerSecond(times), Math.min(rate, 1000 / processTimeMs));
});

test("throttle memoize option", async t => {
    const concurrency = 1;
    const rate = 100;
    let counter = 0;
    const N = 5;
    async function fn(_: number) {
        counter++;
    }
    const throttledFn = throttle({ concurrency, rate, memoize: true }, fn);

    const promises = [];
    for (let i = 0; i < N; i++) {
        promises.push(throttledFn(i));
    }
    for (let i = 0; i < N; i++) {
        promises.push(throttledFn(i));
    }

    await Promise.all(promises);
    t.is(counter, N);
});

test("throttle cache option persists values", async t =>
    withCache(async cache => {
        const concurrency = 1;
        const rate = 100;
        let counter = 0;

        async function fn(_: number) {
            return counter++;
        }

        const throttledFn = throttle({ concurrency, rate, cache }, fn);

        const v = await throttledFn(10);
        t.is(v, 0);

        const throttledFn2 = throttle({ concurrency, rate, cache }, fn);

        const u1 = await throttledFn2(10);
        const u2 = await throttledFn2(20);

        t.is(u1, 0);
        t.is(u2, 1);
        t.is(counter, 2);
    }));

test("throttle cache and memoize options work together", async t =>
    withCache(async cache => {
        const concurrency = 1;
        const rate = 100;
        let counter = 0;

        async function fn(_: number) {
            return counter++;
        }

        const throttledFn = throttle({ concurrency, rate, memoize: true, cache }, fn);

        const v = await throttledFn(10);
        const v2 = await throttledFn(10);
        t.is(v, 0);
        t.is(v2, 0);

        const throttledFn2 = throttle({ concurrency, rate, memoize: true, cache }, fn);

        const u1 = await throttledFn2(10);
        const u2 = await throttledFn2(20);
        const u3 = await throttledFn2(10);

        t.is(u1, 0);
        t.is(u2, 1);
        t.is(u3, 0);

        t.is(counter, 2);
    }));

test("async queue works with enqueue before dequeue", async t => {
    const q = new AsyncQueue<number>();
    q.enqueue(42);
    t.is(await q.dequeue(), 42);
});

test("async queue works with dequeue before enqueue", async t => {
    const q = new AsyncQueue<number>();
    const promise = q.dequeue();
    q.enqueue(42);
    t.is(await promise, 42);
});

test("async queue transition from more enqueues to more dequeues", async t => {
    const q = new AsyncQueue<number>();
    q.enqueue(42);
    t.is(await q.dequeue(), 42);
    const promise = q.dequeue();
    q.enqueue(100);
    t.is(await promise, 100);
});

test("async queue transition from more dequeues to more enqueues", async t => {
    const q = new AsyncQueue<number>();
    const promise = q.dequeue();
    q.enqueue(42);
    q.enqueue(100);
    t.is(await promise, 42);
    t.is(await q.dequeue(), 100);
});

test("async queue handles multiple dequeues before enqueues", async t => {
    const q = new AsyncQueue<number>();
    const p1 = q.dequeue();
    const p2 = q.dequeue();
    const p3 = q.dequeue();

    q.enqueue(42);
    t.is(await p1, 42);
    q.enqueue(100);
    t.is(await p2, 100);
    q.enqueue(0);
    t.is(await p3, 0);
});

test("async queue handles async enqueueing", async t => {
    const q = new AsyncQueue<number>();
    const promise = q.dequeue();
    setTimeout(() => q.enqueue(99), 100);
    t.is(await promise, 99);
});

test("async queue handles async dequeueing", async t => {
    t.plan(1);
    const q = new AsyncQueue<number>();
    q.enqueue(88);
    await new Promise(resolve =>
        setTimeout(async t => {
            t.is(await q.dequeue(), 88);
            resolve();
        }, 100)
    );
});

test("async queue clear", async t => {
    const q = new AsyncQueue<number>();
    q.enqueue(1);
    q.clear();
    q.enqueue(2);
    t.is(await q.dequeue(), 2);

    const p1 = q.dequeue();
    q.clear();
    const p2 = q.dequeue();
    q.enqueue(3);
    t.is(await p2, 3);
});
