import { sleep } from "../src/shared";
import {
    Deferred,
    Funnel,
    Pump,
    RateLimiter,
    retry,
    throttle,
    cacheFn
} from "../src/throttle";
import { timer, Timing } from "./functions";
import { measureConcurrency } from "./tests";
import { LocalCache } from "../src/cache";

describe("Deferred promise", () => {
    test("resolves its promise", async () => {
        const deferred = new Deferred();
        let resolved = false;
        deferred.promise.then(_ => (resolved = true));
        expect(resolved).toBe(false);
        deferred.resolve();
        await deferred.promise;
        expect(resolved).toBe(true);
    });
    test("rejects its promise", async () => {
        const deferred = new Deferred();
        let rejected = false;
        expect(rejected).toBe(false);
        deferred.reject();
        try {
            await deferred.promise;
        } catch (_) {
            rejected = true;
        }
        expect(rejected).toBe(true);
    });
    test("resolves only once", async () => {
        const deferred = new Deferred();
        let value = 0;
        deferred.promise.then(_ => value++);

        deferred.resolve();
        await deferred.promise;
        expect(value).toBe(1);

        deferred.resolve();
        await deferred.promise;
        expect(value).toBe(1);
    });
    test("cannot reject after resolving", async () => {
        const deferred = new Deferred();
        let value = 0;
        deferred.promise.then(_ => value++);

        deferred.resolve();
        await deferred.promise;
        expect(value).toBe(1);

        deferred.reject();
        await deferred.promise;
        expect(value).toBe(1);
    });
});

describe("Funnel", () => {
    test("Defaults to infinite concurrency (tested with 200)", async () => {
        const funnel = new Funnel<Timing>(0);
        const promises = [];
        const N = 200;
        for (let i = 0; i < N; i++) {
            promises.push(funnel.push(() => timer(300)));
        }
        const times = await Promise.all(promises);
        expect(measureConcurrency(times)).toBe(N);
    });

    test("Single concurrency is mutually exclusive", async () => {
        const funnel = new Funnel<Timing>(1);
        const promises = [];
        const N = 10;
        for (let i = 0; i < N; i++) {
            promises.push(funnel.push(() => timer(10)));
        }
        const times = await Promise.all(promises);
        expect(measureConcurrency(times)).toBe(1);
    });
    test("Handles concurrency level 2", async () => {
        const funnel = new Funnel<Timing>(2);
        const promises = [];
        const N = 10;
        for (let i = 0; i < N; i++) {
            promises.push(funnel.push(() => timer(20)));
        }
        const times = await Promise.all(promises);
        expect(measureConcurrency(times)).toBe(2);
    });
    test("Handles concurrency level 10", async () => {
        const funnel = new Funnel<Timing>(10);
        const promises = [];
        const N = 100;
        for (let i = 0; i < N; i++) {
            promises.push(funnel.push(() => timer(20)));
        }
        const times = await Promise.all(promises);
        expect(measureConcurrency(times)).toBe(10);
    });
    test("Resumes after finishing funnel", async () => {
        const funnel = new Funnel<Timing>(1);
        const time1 = await funnel.push(() => timer(10));
        const time2 = await funnel.push(() => timer(10));
        expect(measureConcurrency([time1, time2])).toBe(1);
    });
    test("clears funnel", async () => {
        const funnel = new Funnel<number>(1);
        let count = 0;
        const promise0 = funnel.push(async () => count++);
        const promise1 = funnel.push(async () => count++);
        const promise2 = funnel.push(async () => count++);
        funnel.clear();
        await expect(promise0).rejects.toThrowError();
        await expect(promise1).rejects.toThrowError();
        await expect(promise2).rejects.toThrowError();
        expect(count).toBe(0);
    });
    test("Funnel gets executed asynchronously, not at the moment of push", async () => {
        const funnel = new Funnel(1);
        let n = 0;
        funnel.push(async () => {
            n++;
        });
        expect(n).toBe(0);
        await funnel.all();
        expect(n).toBe(1);
    });
    test("handles promise rejections without losing concurrency", async () => {
        const funnel = new Funnel<void>(1);
        let executed = false;
        await expect(funnel.push(() => Promise.reject("message"))).rejects.toBe(
            "message"
        );
        await funnel.push(async () => {
            executed = true;
        });
        expect(executed).toBe(true);
    });
    test("funnel.all() waits for all requests to finish", async () => {
        const funnel = new Funnel<string>(1);
        let executed = false;
        funnel.push(async () => {
            await sleep(200);
            executed = true;
            return "first";
        });
        funnel.push(async () => "second");
        expect(executed).toBe(false);
        const result = await funnel.all();
        expect(result.length).toBe(2);
        expect(result[0]).toBe("first");
        expect(result[1]).toBe("second");
        expect(executed).toBe(true);
    });
    test("funnel.all() ignores errors and waits for other requests to finish", async () => {
        const funnel = new Funnel<string>(1);
        funnel.push(async () => {
            throw new Error();
        });
        funnel.push(async () => {
            await sleep(100);
            return "done";
        });
        const result = await funnel.all();
        expect(result.length).toBe(2);
        expect(result[0]).toBeUndefined();
        expect(result[1]).toBe("done");
    });
    test("retry() retries failures", async () => {
        let attempts = 0;
        await retry(2, async () => {
            attempts++;
            throw new Error();
        }).catch(_ => {});
        expect(attempts).toBe(3);
    });
    test("funnel shouldRetry parameter retries failures", async () => {
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
        expect(attempts).toBe(3);
        expect(errors).toBe(1);
    }, 10000);
    test("Funnel cancellation", async () => {
        const funnel = new Funnel(1);
        let executed = 0;

        const promise = funnel.push(
            async () => {
                executed++;
            },
            0,
            () => "cancelled"
        );
        await expect(promise).rejects.toThrowError();
        expect(executed).toBe(0);
    });
    test("Funnel processed and error counts", async () => {
        const funnel = new Funnel(2);
        funnel.push(async () => {});
        funnel.push(async () => Promise.reject());
        funnel.push(async () => {});
        funnel.push(async () => Promise.reject());
        funnel.push(async () => {});

        await funnel.all();
        expect(funnel.processed).toBe(3);
        expect(funnel.errors).toBe(2);
    });
});

describe("Pump", () => {
    test("Works for concurrency level 1", async () => {
        let executed = 0;
        const pump = new Pump(1, () => {
            executed++;
            return sleep(100);
        });
        expect(executed).toBe(0);
        pump.start();
        await sleep(300);
        pump.stop();
        expect(executed).toBeGreaterThan(1);
    });

    test("Works for concurrency level 10", async () => {
        let executed = 0;
        const pump = new Pump(10, () => {
            executed++;
            return sleep(100);
        });
        pump.start();
        await sleep(100);
        pump.stop();
        expect(executed).toBe(10);
    });

    test("handles promise rejections without losing concurrency", async () => {
        let executed = 0;
        const pump = new Pump(1, () => {
            executed++;
            return sleep(100).then(_ => Promise.reject("hi"));
        });
        pump.start();
        await sleep(500);
        pump.stop();
        expect(executed).toBe(5);
    });
    test("drain", async () => {
        let started = 0;
        let finished = 0;
        const N = 5;

        const pump = new Pump(N, async () => {
            started++;
            await sleep(100);
            finished++;
        });

        expect(started).toBe(0);
        expect(finished).toBe(0);

        pump.start();
        await pump.drain();
        expect(started).toBe(N);
        expect(finished).toBe(N);
    });
});

describe("memoize", () => {
    test("Returns cached results for the same key", async () => {
        const promises = [];
        const N = 10;
        const timerFn = throttle({ memoize: true, concurrency: 1, rate: 10 }, _ =>
            timer(10)
        );
        for (let i = 0; i < N; i++) {
            promises.push(timerFn("key"));
        }
        const times = await Promise.all(promises);
        expect(measureConcurrency(times)).toBe(N);
    });
    test("Runs the worker for different keys", async () => {
        const promises = [];
        const N = 10;
        const timerFn = throttle({ memoize: true, concurrency: 1, rate: 10 }, _ =>
            timer(10)
        );
        for (let i = 0; i < N; i++) {
            promises.push(timerFn(i));
        }
        const times = await Promise.all(promises);
        expect(measureConcurrency(times)).toBe(1);
    });
});

describe("caching function values on disk", () => {
    let cache: LocalCache;
    beforeEach(() => {
        cache = new LocalCache(".faast/test");
    });
    afterEach(async () => {
        await cache.clear();
    });
    test("saves values in cache", async () => {
        let counter = 0;
        function fn(_: number) {
            return Promise.resolve(counter++);
        }
        const mfn = cacheFn(cache, fn);
        await mfn(0);
        await mfn(7);
        await mfn(0);
        expect(counter).toBe(2);

        const mfn2 = cacheFn(cache, fn);
        await mfn2(0);
        await mfn2(7);
        await mfn2(0);
        await mfn2(10);
        expect(counter).toBe(3);
    });

    test("string arguments", async () => {
        let counter = 0;
        function fn(_: string) {
            return Promise.resolve(counter++);
        }
        const mfn = cacheFn(cache, fn);
        await mfn("a");
        await mfn("b");
        await mfn("a");
        expect(counter).toBe(2);
    });

    test("object arguments", async () => {
        let counter = 0;
        function fn(_: { f: string; i: number }) {
            return Promise.resolve(counter++);
        }
        const mfn = cacheFn(cache, fn);
        await mfn({ f: "field", i: 42 });
        await mfn({ f: "field", i: 1 });
        await mfn({ f: "other", i: 42 });
        await mfn({ f: "field", i: 42 });
        expect(counter).toBe(3);
    });

    test("does not cache promise rejection from cached function", async () => {
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
        expect(counter).toBe(3);
        expect(caught).toBe(3);
    });
});

function measureMaxRequestRatePerSecond(timings: Timing[]) {
    const requestsPerSecondStartingAt = timings
        .map(t => t.start)
        .map(t => timings.filter(({ start }) => start >= t && start < t + 1000).length);
    return Math.max(...requestsPerSecondStartingAt);
}

describe("RateLimiter", () => {
    test(
        "Rate limits",
        async () => {
            const requestRate = 10;
            const rateLimiter = new RateLimiter<Timing>(requestRate);
            const promises: Promise<Timing>[] = [];
            for (let i = 0; i < 15; i++) {
                promises.push(rateLimiter.push(() => timer(0)));
            }
            const timings = await Promise.all(promises);
            expect(measureMaxRequestRatePerSecond(timings)).toBe(requestRate);
        },
        10 * 1000
    );

    test(
        "Rate limits across second boundaries",
        async () => {
            const requestRate = 10;
            const rateLimiter = new RateLimiter<Timing>(requestRate);
            const promises: Promise<Timing>[] = [];
            promises.push(rateLimiter.push(() => timer(0)));
            await sleep(900);
            for (let i = 0; i < 15; i++) {
                promises.push(rateLimiter.push(() => timer(0)));
            }
            const timings = await Promise.all(promises);
            expect(measureMaxRequestRatePerSecond(timings)).toBe(requestRate);
        },
        10 * 1000
    );

    test(
        "Bursting allows for request rate beyond target rate",
        async () => {
            const requestRate = 10;
            const maxBurst = 5;
            const rateLimiter = new RateLimiter<Timing>(requestRate, maxBurst);
            const promises: Promise<Timing>[] = [];
            for (let i = 0; i < 15; i++) {
                promises.push(rateLimiter.push(() => timer(0)));
            }
            const timings = await Promise.all(promises);
            const maxRate = measureMaxRequestRatePerSecond(timings);
            expect(maxRate).toBeLessThanOrEqual(maxBurst + requestRate);
            expect(maxRate).toBeGreaterThan(maxBurst);
        },
        10 * 1000
    );
});

describe("throttle", () => {
    test(
        "Limits max concurrency and rate",
        async () => {
            const concurrency = 10;
            const rate = 10;
            const timerFn = throttle({ concurrency, rate }, timer);
            const promises = [];
            for (let i = 0; i < 15; i++) {
                promises.push(timerFn(1000));
            }

            const times = await Promise.all(promises);
            expect(measureConcurrency(times)).toBe(concurrency);
            expect(measureMaxRequestRatePerSecond(times)).toBe(rate);
        },
        12 * 1000
    );

    test(
        "Limits rate with single concurrency",
        async () => {
            const concurrency = 1;
            const rate = 10;
            const processTimeMs = 200;
            const timerFn = throttle({ concurrency, rate }, timer);

            const promises = [];
            for (let i = 0; i < 10; i++) {
                promises.push(timerFn(processTimeMs));
            }

            const times = await Promise.all(promises);
            expect(measureConcurrency(times)).toBe(concurrency);
            expect(measureMaxRequestRatePerSecond(times)).toBe(
                Math.min(rate, 1000 / processTimeMs)
            );
        },
        10 * 1000
    );

    test("memoizes", async () => {
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
        expect(counter).toBe(N);
    });

    let cache: LocalCache;

    afterEach(async () => {
        if (cache) {
            await cache.clear();
        }
    });

    test("caches on disk", async () => {
        const concurrency = 1;
        const rate = 100;
        let counter = 0;
        cache = new LocalCache(".faast/test");

        async function fn(_: number) {
            return counter++;
        }

        const throttledFn = throttle({ concurrency, rate, cache }, fn);

        const v = await throttledFn(10);
        expect(v).toBe(0);

        const throttledFn2 = throttle({ concurrency, rate, cache }, fn);

        const u1 = await throttledFn2(10);
        const u2 = await throttledFn2(20);

        expect(u1).toBe(0);
        expect(u2).toBe(1);
        expect(counter).toBe(2);
    });

    test("caching and memoization work together", async () => {
        const concurrency = 1;
        const rate = 100;
        let counter = 0;
        cache = new LocalCache(".faast/test");

        async function fn(_: number) {
            return counter++;
        }

        const throttledFn = throttle({ concurrency, rate, memoize: true, cache }, fn);

        const v = await throttledFn(10);
        const v2 = await throttledFn(10);
        expect(v).toBe(0);
        expect(v2).toBe(0);

        const throttledFn2 = throttle({ concurrency, rate, memoize: true, cache }, fn);

        const u1 = await throttledFn2(10);
        const u2 = await throttledFn2(20);
        const u3 = await throttledFn2(10);

        expect(u1).toBe(0);
        expect(u2).toBe(1);
        expect(u3).toBe(0);

        expect(counter).toBe(2);
    });
});
