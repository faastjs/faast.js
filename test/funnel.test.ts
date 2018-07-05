import { Funnel, AutoFunnel, Pump } from "../src/funnel";

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function timer(ms: number) {
    const start = Date.now();
    await delay(ms);
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

function measureConcurrency(timings: Timing[]) {
    const concurrencyAtStartTimes = timings
        .map(t => t.start)
        .map(t => timings.filter(({ start, end }) => start <= t && t < end).length);
    return Math.max(...concurrencyAtStartTimes);
}

describe("Funnel", () => {
    test("Defaults to infinite concurrency (tested with 200)", async () => {
        const funnel = new Funnel(0);
        const promises = [];
        const N = 200;
        for (let i = 0; i < N; i++) {
            promises.push(funnel.push(() => timer(300)));
        }
        const times = await Promise.all(promises);
        expect(measureConcurrency(times)).toBe(N);
    });

    test("Single concurrency is mutually exclusive", async () => {
        const funnel = new Funnel(1);
        const promises = [];
        const N = 10;
        for (let i = 0; i < N; i++) {
            promises.push(funnel.push(() => timer(10)));
        }
        const times = await Promise.all(promises);
        expect(measureConcurrency(times)).toBe(1);
    });
    test("Handles concurrency level 2", async () => {
        const funnel = new Funnel(2);
        const promises = [];
        const N = 10;
        for (let i = 0; i < N; i++) {
            promises.push(funnel.push(() => timer(20)));
        }
        const times = await Promise.all(promises);
        expect(measureConcurrency(times)).toBe(2);
    });
    test("Handles concurrency level 10", async () => {
        const funnel = new Funnel(10);
        const promises = [];
        const N = 100;
        for (let i = 0; i < N; i++) {
            promises.push(funnel.push(() => timer(20)));
        }
        const times = await Promise.all(promises);
        expect(measureConcurrency(times)).toBe(10);
    });
    test("Resumes after finishing funnel", async () => {
        const funnel = new Funnel(1);
        const time1 = await funnel.push(() => timer(10));
        const time2 = await funnel.push(() => timer(10));
        expect(measureConcurrency([time1, time2])).toBe(1);
    });
    test("clears funnel", async () => {
        const funnel = new Funnel(1);
        let count = 0;
        const promise = funnel.push(async () => {
            count++;
        });
        funnel
            .push(async () => {
                count++;
            })
            .catch(_ => {});
        funnel
            .push(async () => {
                count++;
            })
            .catch(_ => {});
        funnel.clear();
        await promise;
        expect(count).toBe(1);
    });
    test("handles promise rejections without losing concurrency", async () => {
        const funnel = new Funnel(1);
        let executed = false;
        expect(funnel.push(() => Promise.reject("message"))).rejects.toBe("message");
        await funnel.push(async () => {
            executed = true;
        });
        expect(executed).toBe(true);
    });
});

describe("AutoFunnel", () => {
    test("Fills workers", async () => {
        const N = 10;
        const funnel = new AutoFunnel(() => timer(10));
        const times = await Promise.all(funnel.fill(N));
        expect(measureConcurrency(times)).toBe(N);
    });
    test("respects maxConcurrency", async () => {
        const N = 10;
        const funnel = new AutoFunnel(() => timer(10));
        funnel.setMaxConcurrency(3);
        const times = await Promise.all(funnel.fill(N));
        expect(measureConcurrency(times)).toBe(3);
    });
});

describe("Pump", () => {
    test("Works for concurrency level 1", async () => {
        let executed = 0;
        const pump = new Pump(1, () => {
            executed++;
            return delay(100);
        });
        pump.start();
        await delay(1000);
        pump.stop();
        expect(executed).toBe(10);
    });

    test("Works for concurrency level 10", async () => {
        let executed = 0;
        const pump = new Pump(10, () => {
            executed++;
            return delay(1000);
        });
        pump.start();
        await delay(1000);
        pump.stop();
        expect(executed).toBe(10);
    });

    test.only("handles promise failures without losing concurrency", async () => {
        let executed = 0;
        const pump = new Pump(1, () => {
            executed++;
            return delay(100).then(_ => Promise.reject("hi"));
        });
        pump.start();
        await delay(500);
        pump.stop();
        expect(executed).toBe(5);
    });
});
