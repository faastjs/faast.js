import { registerFunction } from "./functionserver";
import { log } from "./log";

export function hello(name: string) {
    return `Hello ${name}!`;
}

export function fact(n: number): number {
    return n <= 1 ? 1 : n * fact(n - 1);
}

export function concat(a: string, b: string) {
    return a + b;
}

registerFunction(fact);
registerFunction(hello);
registerFunction(concat);
log(`Registered functions`);
