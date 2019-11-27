export function test() {
    return "Successfully called test function.";
}

export function empty() {}

export function identityString(name: string) {
    return name;
}
export function identityNum(n: number) {
    return n;
}
export function identityBool(b: boolean) {
    return b;
}
export function identityUndefined(u: undefined) {
    return u;
}
export function identityNull(n: null) {
    return n;
}
export function identityObject(o: object) {
    return o;
}
export function identityArrayNum(n: number[]) {
    return n;
}
export function identityArrayString(s: string[]) {
    return s;
}
export function identityInt8(a: Int8Array) {
    return a;
}
export function identityUint8(a: Uint8Array) {
    return a;
}
export function identityUint8Clamped(a: Uint8ClampedArray) {
    return a;
}
export function identityInt16(a: Int16Array) {
    return a;
}
export function identityUint16(a: Uint16Array) {
    return a;
}
export function identityInt32(a: Int32Array) {
    return a;
}
export function identityUint32(a: Uint32Array) {
    return a;
}
export function identityFloat32(a: Float32Array) {
    return a;
}
export function identityFloat64(a: Float64Array) {
    return a;
}
export function identityBigInt64(a: BigInt64Array) {
    return a;
}
export function identityBigUint64(a: BigUint64Array) {
    return a;
}
export function identityMap(m: Map<number, number>) {
    return m;
}
export function identitySet(s: Set<number>) {
    return s;
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

export function processExit(code?: number) {
    process.exit(code);
}

class CustomError extends Error {
    constructor(message: string, public custom: string) {
        super(message);
    }
}

export function customError() {
    throw new CustomError("custom error message", "custom value");
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

export function getEnv(key: string) {
    return process.env[key];
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

/**
 * Not supported.
 * @remarks
 * Examples of functions arguments or return values that are not supported.
 */
export function promiseArg(promise: Promise<any>) {
    return promise;
}

export function identityFunction(fn: () => void) {
    return fn;
}

export function functionReturn() {
    return () => {
        console.log("returned a function");
    };
}

export function identityBuffer(buf: Buffer) {
    return buf;
}

export function identityDate(arg: Date) {
    return arg;
}

export class Cls {
    constructor() {}
}

export function identityClass(arg: Cls) {
    return arg;
}

export function classReturn() {
    return new Cls();
}
