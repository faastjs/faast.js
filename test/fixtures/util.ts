import { ExecutionContext } from "ava";
import lolex from "lolex";
import { inspect } from "util";
import { CommonOptions, log, Provider } from "../../index";
import { IteratorResponseMessage, Message } from "../../src/provider";
import { deserialize } from "../../src/serialize";
import { keysOf } from "../../src/shared";
import { Timing } from "./functions";
export { keysOf };

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
    const clock = lolex.install({ shouldAdvanceTime: true, now: Date.now() });
    try {
        await fn(clock);
    } finally {
        clock.uninstall();
    }
}

export function checkResourcesCleanedUp<T extends object>(
    t: ExecutionContext,
    resources: Partial<T>
) {
    for (const key of keysOf(resources)) {
        t.is(resources[key], undefined);
        if (resources[key] !== undefined) {
            console.log(`Resource '${String(key)}' not cleaned up: %O`, resources[key]);
        }
    }
}

export interface RecordedCall<A extends any[], R> {
    args: A;
    rv: R;
}

export interface RecordedFunction<A extends any[], R> {
    (...args: A): R;
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

export const configs: CommonOptions[] = [
    // { mode: "https", childProcess: false, validateSerialization: true },
    { mode: "https", childProcess: true, validateSerialization: true },
    // { mode: "queue", childProcess: false, validateSerialization: true },
    { mode: "queue", childProcess: true, validateSerialization: true }
];

export const noValidateConfigs = configs.map(c => ({
    ...c,
    validateSerialization: false
}));

export function title(provider: Provider, msg: string, options?: object) {
    const desc = options ? inspect(options, { breakLength: Infinity }) : "";
    return [provider === "local" ? "" : "remote", provider, msg, desc]
        .filter(x => x !== "")
        .join(" ");
}

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function toArray<T>(gen: AsyncIterable<T> | Iterable<T>) {
    const result = [];
    for await (const elem of gen) {
        result.push(elem);
    }
    return result;
}

export function expectMessage<T>(
    t: ExecutionContext,
    msg: Message,
    kind: "promise" | "iterator",
    expected: T
) {
    t.is(msg.kind, kind);
    if (msg.kind === kind) {
        const [value] = deserialize(msg.value);
        t.deepEqual(value, expected);
    }
}

export function checkIteratorMessages(
    t: ExecutionContext,
    rawMessages: IteratorResponseMessage[],
    arg: string[]
) {
    const messages = [];
    t.is(rawMessages.length, arg.length + 1);
    for (const msg of rawMessages) {
        messages[msg.sequence] = msg;
    }

    let i = 0;
    for (; i < arg.length; i++) {
        expectMessage(t, messages[i], "iterator", { done: false, value: arg[i] });
    }
    expectMessage(t, messages[i], "iterator", { done: true });
}
