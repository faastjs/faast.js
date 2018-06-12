import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";
import { checkFunctions } from "./functions-expected";

let cloud: cloudify.AWS;
let lambda: cloudify.AWSLambda;
let remote: cloudify.Promisified<typeof funcs>;

beforeAll(async () => {
    try {
        cloud = cloudify.create("aws");
        lambda = await cloud.createFunction("./functions", {
            //cloudSpecific: { useQueue: false }
        });
        remote = lambda.cloudifyAll(funcs);
    } catch (err) {
        console.error(err);
    }
}, 30 * 1000);

checkFunctions("Cloudify AWS", () => remote);

afterAll(() => lambda.cleanup(), 30 * 1000);
//afterAll(() => lambda.cancelAll(), 30 * 1000);
