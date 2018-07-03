import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";
import { checkFunctions } from "./functions-expected";

let cloud: cloudify.Google;
let cloudFunctionQueue: cloudify.GoogleCloudFunction;
let cloudFunctionHttps: cloudify.GoogleCloudFunction;

beforeAll(async () => {
    try {
        cloud = cloudify.create("google");
        cloudFunctionQueue = await cloud.createFunction("./functions");
        cloudFunctionHttps = await cloud.createFunction("./functions", {
            useQueue: false
        });
    } catch (err) {
        console.error(err);
    }
}, 90 * 1000);

checkFunctions("Queue trigger", () => cloudFunctionQueue.cloudifyAll(funcs));
checkFunctions("Https trigger", () => cloudFunctionHttps.cloudifyAll(funcs));

afterAll(async () => {
    cloudFunctionQueue && (await cloudFunctionQueue.cleanup());
    cloudFunctionHttps && (await cloudFunctionHttps.cleanup());
}, 30 * 1000);

// afterAll(async () => {
//     cloudFunctionQueue && (await cloudFunctionQueue.cancelAll());
//     cloudFunctionHttps && (await cloudFunctionHttps.cancelAll());
// }, 30 * 1000);
