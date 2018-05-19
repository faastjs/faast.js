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
    throw new Error(`This error was thrown remotely. Argument: ${a}`);
}

export function noargs() {
    return "successfully called function with no args.";
}
