import { Timing } from "./functions";

export function measureConcurrency(timings: Timing[]) {
    return timings
        .map(t => t.start)
        .map(t => timings.filter(({ start, end }) => start <= t && t < end).length)
        .reduce((a, b) => Math.max(a, b));
}

export const sum = (a: number[]) => a.reduce((total, n) => total + n, 0);

export const avg = (a: number[]) => sum(a) / a.length;

export const stdev = (a: number[]) => {
    const average = avg(a);
    return Math.sqrt(avg(a.map(v => (v - average) ** 2)));
};
