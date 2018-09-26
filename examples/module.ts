export function hello(name: string) {
    return "hello " + name + "!";
}

export function randomNumbers(n: number) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
        sum += Math.random();
    }
    return sum;
}
