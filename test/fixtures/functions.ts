export function test() {
    return "Successfully called test function.";
}

export function identity(name: string) {
    return name;
}

export const arrow = (str: string) => str;

export const asyncArrow = async (str: string) => str;

export function hello(name: string) {
    return `Hello ${name}!`;
}

export function fact(n: number): number {
    return n <= 1 ? 1 : n * fact(n - 1);
}

export function concat(a: string, b: string) {
    return a + b;
}

export function error(a: string) {
    throw new Error(`Expected error. Arg: ${a}`);
}

export function noargs() {
    return "called function with no args.";
}

export function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export function delayReject(ms: number) {
    return new Promise((_, reject) => setTimeout(reject, ms));
}

export function echo(n: number) {
    return n;
}

export async function async() {
    await sleep(200);
    return "async function: success";
}

export function path(): Promise<string> {
    return sleep(200).then(() => process.env.PATH || "no PATH variable");
}

export function emptyReject() {
    return Promise.reject();
}

export function rejected(): Promise<void> {
    return Promise.reject("intentionally rejected");
}

export interface Timing {
    start: number;
    end: number;
}

export async function timer(delayMs: number): Promise<Timing> {
    const start = Date.now();
    await sleep(delayMs);
    const end = Date.now();
    return { start, end };
}

export function spin(ms: number): Timing {
    const start = Date.now();
    while (true) {
        if (Date.now() - start >= ms) {
            break;
        }
    }
    const end = Date.now();
    return { start, end };
}

export function promiseArg(promise: Promise<any>) {
    return promise;
}

export function optionalArg(arg?: string) {
    return arg ? arg : "No arg";
}

export function consoleLog(str: string) {
    console.log(str);
}

export function consoleWarn(str: string) {
    console.warn(str);
}

export function consoleError(str: string) {
    console.error(str);
}

export function consoleInfo(str: string) {
    console.info(str);
}

export function processExit() {
    process.exit();
}

class CustomError extends Error {
    constructor(message: string, public custom: string) {
        super(message);
    }
}

export function customError() {
    throw new CustomError("message", "custom");
}

export async function allocate(bytes: number) {
    const array = new Array(bytes / 8);
    const elems = array.length;
    for (let i = 0; i < elems; i++) {
        array[i] = i;
    }
    console.log(`allocated: %O`, { bytes, elems });
    console.log(`post allocate memory usage: %O`, process.memoryUsage());
    await sleep(1000);
    console.log(`Returning from allocate`);
    return { bytes, elems };
}

export interface MonteCarloReturn {
    inside: number;
    samples: number;
}

export function monteCarloPI(samples: number): MonteCarloReturn {
    let inside = 0;
    for (let n = 0; n < samples; n++) {
        const [x, y] = [Math.random(), Math.random()];
        if (x ** 2 + y ** 2 <= 1) {
            inside++;
        }
    }
    return {
        inside,
        samples
    };
}
