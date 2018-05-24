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

function delay(ms: number) {
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
    return Promise.reject("This promise is expected to be rejected.");
}

console.log(`Successfully loaded functions`);
