import { Funnel, Pump } from "../src/funnel";
import { sleep } from "../src/shared";

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
        const promise = funnel.push(async () => count++);
        funnel.push(async () => count++);
        funnel.push(async () => count++);
        funnel.clearPending();
        await promise;
        expect(count).toBe(1);
    });
    test("handles promise rejections without losing concurrency", async () => {
        const funnel = new Funnel<void>(1);
        let executed = false;
        expect(funnel.push(() => Promise.reject("message"))).rejects.toBe("message");
        await funnel.push(async () => {
            executed = true;
        });
        expect(executed).toBe(true);
    });
    test("pending waits for all pending requests to finish", async () => {
        const funnel = new Funnel<string>(1);
        let executed = false;
        funnel.push(async () => {
            await sleep(200);
            executed = true;
            return "first";
        });
        funnel.push(async () => "second");
        expect(executed).toBe(false);
        const result = await Promise.all(funnel.pending());
        expect(result.length).toBe(1);
        expect(result[0]).toBe("second");
        expect(executed).toBe(true);
    });
});

describe("Pump", () => {
    test("Works for concurrency level 1", async () => {
        let executed = 0;
        let executing = false;
        const pump = new Pump(1, () => {
            executed++;
            expect(executing).toBe(false);
            executing = true;
            return delay(100).then(_ => (executing = false));
        });
        pump.start();
        await delay(500);
        pump.stop();
        expect(executed).toBe(5);
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

    test("handles promise rejections without losing concurrency", async () => {
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
