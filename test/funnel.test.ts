import { Funnel } from "../src/funnel";

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
});
