export function test() {
    return "Successfully called test function.";
}

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
    throw new Error(`Expected this error. Argument: ${a}`);
}

export function noargs() {
    return "successfully called function with no args.";
}

export function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function async() {
    await delay(200);
    return "returned successfully from async function";
}

export function path(): Promise<string> {
    return delay(200).then(() => process.env["PATH"] || "no PATH variable");
}

export function rejected(): Promise<string> {
    return Promise.reject("This promise is intentionally rejected.");
}

export interface MonteCarloReturn {
    inside: number;
    samples: number;
    clientStart: number;
    start: number;
    end: number;
    startLatency: number;
}

export function monteCarloPI(samples: number, clientStart: number): MonteCarloReturn {
    let inside = 0;
    const start = Date.now();
    for (let n = 0; n < samples; n++) {
        const [x, y] = [Math.random(), Math.random()];
        if (x ** 2 + y ** 2 <= 1) {
            inside++;
        }
    }
    const end = Date.now();
    return {
        inside,
        samples,
        clientStart,
        start,
        end,
        startLatency: start - clientStart
    };
}

export async function timer(delayMs: number) {
    const start = Date.now();
    await delay(delayMs);
    const end = Date.now();
    return { start, end };
}
