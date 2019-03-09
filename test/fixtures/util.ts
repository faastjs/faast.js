import { ExecutionContext } from "ava";
import * as lolex from "lolex";
import { inspect } from "util";
import { CommonOptions, log, Provider } from "../../index";
import { keys } from "../../src/shared";
import { Timing } from "./functions";
export { keys };

export const measureConcurrency = (timings: Timing[]) =>
    timings
        .map(t => t.start)
        .map(t => timings.filter(({ start, end }) => start <= t && t < end).length)
        .reduce((a, b) => Math.max(a, b));

export const sum = (a: number[]) => a.reduce((total, n) => total + n, 0);

export const avg = (a: number[]) => sum(a) / a.length;

export const stdev = (a: number[]) => {
    const average = avg(a);
    return Math.sqrt(avg(a.map(v => (v - average) ** 2)));
};

export type VClock = lolex.InstalledClock<lolex.Clock>;

export async function withClock(fn: (clock: VClock) => Promise<void>) {
    const clock = lolex.install({ shouldAdvanceTime: true });
    try {
        await fn(clock);
    } finally {
        clock.uninstall();
    }
}

export function quietly<T>(p: Promise<T>) {
    return p.catch(_ => {});
}

export function checkResourcesCleanedUp<T extends object>(
    t: ExecutionContext,
    resources: T
) {
    for (const key of keys(resources)) {
        t.is(resources[key], undefined);
    }
}

export interface RecordedCall<A extends any[], R> {
    args: A;
    rv: R;
}

export interface RecordedFunction<A extends any[], R> {
    (...any: A): R;
    recordings: Array<RecordedCall<A, R>>;
}

export function record<A extends any[], R>(fn: (...args: A) => R) {
    const func: RecordedFunction<A, R> = Object.assign(
        (...args: A) => {
            const rv = fn(...args);
            func.recordings.push({ args, rv });
            log.info(`func.recordings: %O`, func.recordings);
            return rv;
        },
        { recordings: [] }
    );
    return func;
}

export function contains<T extends U, U extends object>(container: T, obj: U) {
    for (const key of keys(obj)) {
        if (!(key in container) || container[key] !== obj[key]) {
            return false;
        }
    }
    log.gc(`Contains: %O, %O`, container, obj);
    return true;
}

export const configs: CommonOptions[] = [
    { mode: "https", childProcess: false },
    { mode: "https", childProcess: true },
    { mode: "queue", childProcess: false },
    { mode: "queue", childProcess: true }
];

export function title(provider: Provider, msg: string, options?: object) {
    const desc = options ? inspect(options, { breakLength: Infinity }) : "";
    return [provider === "local" ? "" : "remote", provider, msg, desc].join(" ");
}

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
