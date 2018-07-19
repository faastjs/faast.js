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

export function allocate(bytes: number) {
    const array = new Array(bytes);
    array.fill(0);
    return array.length;
}

export function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function hello(str: string) {
    return "hello " + str;
}
