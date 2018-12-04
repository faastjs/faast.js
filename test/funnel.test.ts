import {
    Funnel,
    Pump,
    RateLimiter,
    retry,
    Deferred,
    memoize,
    limit
} from "../src/funnel";
import { sleep } from "../src/shared";
import { timer, Timing } from "./functions";
import { measureConcurrency } from "./util";

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
        const funnel = new Funnel<Timing>(1);
        const promises = [];
        const N = 10;
        const timerFn = memoize(_ => timer(10));
        for (let i = 0; i < N; i++) {
            promises.push(funnel.push(() => timerFn("key")));
        }
        const times = await Promise.all(promises);
        expect(measureConcurrency(times)).toBe(N);
    });
    test("Runs the worker for different keys", async () => {
        const funnel = new Funnel<Timing>(1);
        const promises = [];
        const N = 10;
        const timerFn = memoize(_ => timer(10));
        for (let i = 0; i < N; i++) {
            promises.push(funnel.push(() => timerFn(i)));
        }
        const times = await Promise.all(promises);
        expect(measureConcurrency(times)).toBe(1);
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

describe("limit function", () => {
    test(
        "Limits max concurrency and rate",
        async () => {
            const maxConcurrency = 10;
            const targetRequestsPerSecond = 10;
            const timerFn = limit({ maxConcurrency, targetRequestsPerSecond }, timer);
            const promises = [];
            for (let i = 0; i < 15; i++) {
                promises.push(timerFn(1000));
            }

            const times = await Promise.all(promises);
            expect(measureConcurrency(times)).toBe(maxConcurrency);
            expect(measureMaxRequestRatePerSecond(times)).toBe(targetRequestsPerSecond);
        },
        12 * 1000
    );

    test(
        "Limits rate with single concurrency",
        async () => {
            const maxConcurrency = 1;
            const targetRequestsPerSecond = 10;
            const processTimeMs = 200;
            const timerFn = limit({ maxConcurrency, targetRequestsPerSecond }, timer);

            const promises = [];
            for (let i = 0; i < 10; i++) {
                promises.push(timerFn(processTimeMs));
            }

            const times = await Promise.all(promises);
            expect(measureConcurrency(times)).toBe(maxConcurrency);
            expect(measureMaxRequestRatePerSecond(times)).toBe(
                Math.min(targetRequestsPerSecond, 1000 / processTimeMs)
            );
        },
        10 * 1000
    );
});
