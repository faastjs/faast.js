import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";
import { checkFunctions } from "./functions-expected";
import { test90, test300 } from "./util";

let cloud: cloudify.AWS;
let lambda: cloudify.AWSLambda;
let remote: cloudify.Promisified<typeof funcs>;

beforeAll(async () => {
    cloud = cloudify.create("aws");
    lambda = await cloud.createFunction("./functions", {
        RoleName: "cloudify-cached-role",
        Timeout: 120
    });
    remote = lambda.cloudifyAll(funcs);
}, 30 * 1000);

test90("Load test ~100 concurrent executions", async () => {
    const N = 100;
    const promises: Promise<string>[] = [];
    for (let i = 0; i < N; i++) {
        promises.push(remote.hello(`function ${i}`));
    }
    const results = await Promise.all(promises);
    results.forEach(m => expect(m).toMatch(/function \d+/));
});

test300("Monte Carlo estimate of PI using 1B samples and 200 invocations", async () => {
    const nParallelFunctions = 200;
    const nSamplesPerFunction = 5000000;
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
    const estimatedPI = inside / samples * 4;
    expect(Number(estimatedPI.toFixed(3))).toBe(3.141);
});

afterAll(() => lambda.cleanup(), 30 * 1000);
