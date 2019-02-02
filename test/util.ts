import { Timing } from "./functions";
import test, { Macro, Assertions, ExecutionContext } from "ava";
import { Deferred } from "../src/throttle";

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

export type TestMacroString = Macro<[() => Promise<string>, string]>;
export type TestMacroNumber = Macro<[() => Promise<number>, number]>;
export type TestMacroError = Macro<[() => Promise<void>, any]>;
export type TestMacroFn = Macro<[(t: ExecutionContext) => Promise<void>]>;
export type TestMacro = TestMacroString | TestMacroNumber | TestMacroError | TestMacroFn;

export const eqMacro = (init: () => Promise<void>, title: (name?: string) => string) => {
    const fn: TestMacro = async <T>(t: Assertions, fn: () => Promise<T>, expected: T) => {
        await init();
        t.is(await fn(), expected);
    };
    fn.title = title;
    return fn as TestMacro;
};

export const rejectErrorMacro = (
    init: () => Promise<void>,
    title: (name?: string) => string
) => {
    const fn: TestMacroError = async (t, fn, expected) => {
        await init();
        await t.throwsAsync(fn(), expected);
    };
    fn.title = title;
    return fn;
};

export const rejectMacro = (
    init: () => Promise<void>,
    title: (name?: string) => string
) => {
    const fn: TestMacroError = async (t, fn, expected) => {
        t.plan(1);
        await init();
        try {
            await fn();
        } catch (err) {
            t.is(err, expected);
        }
    };
    fn.title = title;
    return fn;
};

export const fnMacro = (init: () => Promise<void>, title: (name?: string) => string) => {
    const mfn: TestMacroFn = async (t, fn) => {
        await init();
        await fn(t);
    };
    mfn.title = title;
    return mfn;
};

export const macros = (
    init: () => Promise<void>,
    title: (name?: string) => string,
    cleanup: () => Promise<void>
) => {
    const onceInit = once(init);
    test.after.always(cleanup);
    return {
        reject: rejectMacro(onceInit, title),
        eq: eqMacro(onceInit, title),
        rejectError: rejectErrorMacro(onceInit, title),
        fn: fnMacro(onceInit, title)
    };
};

export function once<T>(fn: () => Promise<T>) {
    let deferred: Deferred<T> | undefined;
    return async () => {
        if (deferred) {
            return deferred.promise;
        }
        deferred = new Deferred();
        const rv = await fn();
        deferred.resolve(rv);
        return rv;
    };
}
