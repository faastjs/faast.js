export function hello(name: string) {
    return `Hello ${name}! (again15)`;
}

export function fact(n: number): number {
    return n <= 1 ? 1 : n * fact(n - 1);
}
