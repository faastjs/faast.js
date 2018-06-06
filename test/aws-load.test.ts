import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";

let cloud: cloudify.Cloud<any, any>;
let lambda: cloudify.CloudFunction<any>;
let remote: cloudify.Promisified<typeof funcs>;

beforeAll(async () => {
    cloud = cloudify.create("aws");
    lambda = await cloud.createFunction("./functions", {
        //Timeout: 120
    });
    remote = lambda.cloudifyAll(funcs);
}, 90 * 1000);

test(
    "Load test ~100 concurrent executions",
    async () => {
        const N = 100;
        const promises: Promise<string>[] = [];
        for (let i = 0; i < N; i++) {
            promises.push(remote.hello(`function ${i}`));
        }
        const results = await Promise.all(promises);
        results.forEach(m => expect(m).toMatch(/function \d+/));
    },
    90 * 1000
);

test(
    "Monte Carlo estimate of PI using 1B samples and 200 invocations",
    async () => {
        const nParallelFunctions = 100;
        const nSamplesPerFunction = 1000000;
        const promises: Promise<{ inside: number; samples: number }>[] = [];
        for (let i = 0; i < nParallelFunctions; i++) {
            promises.push(remote.monteCarloPI(nSamplesPerFunction));
        }
        const results = await Promise.all(promises);
        let inside = 0;
        let samples = 0;
        results.forEach(m => {
            inside += m.inside;
            samples += m.samples;
        });
        console.log(`inside: ${inside}, samples: ${samples}`);
        expect(samples).toBe(nParallelFunctions * nSamplesPerFunction);
        const estimatedPI = (inside / samples) * 4;
        expect(Number(estimatedPI.toFixed(2))).toBe(3.14);
    },
    300 * 1000
);

afterAll(() => lambda.cleanup(), 30 * 1000);
