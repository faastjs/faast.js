import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";
import * as nock from "nock";
import { log } from "../src/log";
import { MonteCarloReturn } from "./functions";

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

function printLatencies(str: string, latencies: number[]) {
    latencies.forEach((n, i) => {
        if (i > 0) {
            log(`${str}[${i}]: ${n}`);
        }
    });
}

test.only(
    "Monte Carlo estimate of PI using 1B samples and 200 invocations",
    async () => {
        //nock.recorder.rec({ logging: log });
        const nParallelFunctions = 200;
        const nSamplesPerFunction = 5000000;
        const promises: Promise<MonteCarloReturn & { returned: number }>[] = [];
        for (let i = 0; i < nParallelFunctions; i++) {
            promises.push(
                remote
                    .monteCarloPI(nSamplesPerFunction, Date.now())
                    .then(x => ({ ...x, returned: Date.now() }))
            );
        }

        const results = await Promise.all(promises);
        let inside = 0;
        let samples = 0;

        let startLatencies = [0];
        let executionLatencies = [0];
        let returnLatencies = [0];

        results.forEach(m => {
            inside += m.inside;
            samples += m.samples;
            startLatencies.push(m.startLatency);
            executionLatencies.push(m.end - m.start);
            returnLatencies.push(m.returned - m.end);
        });

        startLatencies.sort((a, b) => a - b);
        executionLatencies.sort((a, b) => a - b);
        returnLatencies.sort((a, b) => a - b);

        log(`Start latencies:`);
        printLatencies("start", startLatencies);
        log(`Execution latencies: `);
        printLatencies("execution", executionLatencies);
        log(`Return latencies:`);
        printLatencies("return", returnLatencies);

        console.log(`inside: ${inside}, samples: ${samples}`);
        expect(samples).toBe(nParallelFunctions * nSamplesPerFunction);
        const estimatedPI = (inside / samples) * 4;
        expect(Number(estimatedPI.toFixed(2))).toBe(3.14);
        //nock.restore();
    },
    300 * 1000
);

afterAll(() => lambda.cleanup(), 30 * 1000);
