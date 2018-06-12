import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";
import { log } from "../src/log";
import { MonteCarloReturn } from "./functions";
import * as aws from "aws-sdk";

let cloud: cloudify.AWS;
let func: cloudify.AWSLambda;
let remote: cloudify.Promisified<typeof funcs>;

beforeAll(async () => {
    try {
        cloud = cloudify.create("aws");
        func = await cloud.createFunction("./functions", {
            // Timeout: 120
            // cloudSpecific: { useQueue: false },
            memorySize: 1024
        });
        remote = func.cloudifyAll(funcs);
        const awsLambda = new aws.Lambda();

        awsLambda.putFunctionConcurrency({
            FunctionName: func.getState().resources.FunctionName,
            ReservedConcurrentExecutions: 10
        });
    } catch (err) {
        console.error(err);
    }
}, 90 * 1000);

test(
    "Load test ~100 concurrent executions with 10 concurrency limit",
    async () => {
        const N = 100;
        const promises: Promise<string>[] = [];
        for (let i = 0; i < N; i++) {
            promises.push(remote.async());
        }
        const results = await Promise.all(promises);
        results.forEach(m => expect(m).toMatch(/function \d+/));
    },
    90 * 1000
);

afterAll(() => func.cleanup(), 30 * 1000);
//afterAll(() => lambda.cancelAll(), 30 * 1000);
