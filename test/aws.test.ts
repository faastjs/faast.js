import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";
import { checkFunctions } from "./functions-expected";

let cloud: cloudify.AWS;
let lambdaQueue: cloudify.AWSLambda;
let lambdaHttps: cloudify.AWSLambda;

beforeAll(async () => {
    try {
        cloud = cloudify.create("aws");
        lambdaQueue = await cloud.createFunction("./functions");
        lambdaHttps = await cloud.createFunction("./functions", { useQueue: false });
    } catch (err) {
        console.error(err);
    }
}, 30 * 1000);

checkFunctions("Queue trigger", () => lambdaQueue.cloudifyAll(funcs));
checkFunctions("Https trigger", () => lambdaHttps.cloudifyAll(funcs));

afterAll(async () => {
    await lambdaQueue.cleanup();
    await lambdaHttps.cleanup();
}, 30 * 1000);

// afterAll(async () => {
//     await lambdaQueue.cancelAll();
//     await lambdaHttps.cancelAll();
// }, 30 * 1000);
