export interface MonteCarloReturn {
    inside: number;
    samples: number;
    start: number;
    end: number;
}

export function monteCarloPI(samples: number): MonteCarloReturn {
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
        start,
        end
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
