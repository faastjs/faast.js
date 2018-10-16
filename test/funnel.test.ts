import { Funnel, Pump, MemoFunnel, RateLimiter, RateLimitedFunnel } from "../src/funnel";
import { sleep } from "../src/shared";
import { delay } from "./functions";

async function timer(ms: number) {
    const start = Date.now();
    await sleep(ms);
    const end = Date.now();
    return {
        start,
        end
    };
}

interface Timing {
    start: number;
    end: number;
}

function foo() {
    return 0;
}

function measureConcurrency(timings: Timing[]) {
    const concurrencyAtStartTimes = timings
        .map(t => t.start)
        .map(t => timings.filter(({ start, end }) => start <= t && t < end).length);
    return Math.max(...concurrencyAtStartTimes);
}

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
        expect(count).toBe(1);
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
        expect(result[0]).toBe("second");
        expect(executed).toBe(true);
    });
    test("Funnel cancellation", async () => {
        const funnel = new Funnel(1);
        let executed = 0;

        const promise = funnel.push(
            async () => {
                executed++;
            },
            () => "cancelled"
        );
        await expect(promise).rejects.toThrowError();
        expect(executed).toBe(0);
    });
});

describe("Pump", () => {
    test("Works for concurrency level 1", async () => {
        let executed = 0;
        const pump = new Pump(1, () => {
            executed++;
            return sleep(100);
        });
        pump.start();
        expect(executed).toBe(1);
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

        pump.start();
        expect(started - finished).toBe(N);
        await pump.drain();
        expect(started - finished).toBe(0);
    });
});

describe("MemoFunnel", () => {
    test("Returns cached results for the same key", async () => {
        const funnel = new MemoFunnel<string, Timing>(1);
        const promises = [];
        const N = 10;
        for (let i = 0; i < N; i++) {
            promises.push(funnel.pushMemoized("key", () => timer(10)));
        }
        const times = await Promise.all(promises);
        expect(measureConcurrency(times)).toBe(N);
    });
    test("Runs the worker for different keys", async () => {
        const funnel = new MemoFunnel<number, Timing>(1);
        const promises = [];
        const N = 10;
        for (let i = 0; i < N; i++) {
            promises.push(funnel.pushMemoized(i, () => timer(10)));
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
            await delay(900);
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

describe("RateLimitedFunnel", () => {
    test(
        "Limits max concurrency and rate",
        async () => {
            const maxConcurrency = 10;
            const targetRequestsPerSecond = 10;
            const rateLimitedFunnel = new RateLimitedFunnel<Timing>({
                maxConcurrency,
                targetRequestsPerSecond
            });

            const promises = [];
            for (let i = 0; i < 15; i++) {
                promises.push(rateLimitedFunnel.push(() => timer(1000)));
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
            const rateLimitedFunnel = new RateLimitedFunnel<Timing>({
                maxConcurrency,
                targetRequestsPerSecond
            });

            const promises = [];
            for (let i = 0; i < 10; i++) {
                promises.push(rateLimitedFunnel.push(() => timer(processTimeMs)));
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
