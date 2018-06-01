import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";
import { checkFunctions } from "./functions-expected";

let cloud: cloudify.AWS;
let lambda: cloudify.CloudFunction;
let remote: cloudify.Promisified<typeof funcs>;

beforeAll(async () => {
    cloud = cloudify.create("aws");
    lambda = await cloud.createFunction("./functions", {
        RoleName: "cloudify-cached-role"
    });
    console.log(`Service created: ${lambda.cloudName}`);
    remote = lambda.cloudifyAll(funcs);
}, 30 * 1000);

checkFunctions("Cloudify AWS", () => remote);

afterAll(() => lambda.cleanup(), 30 * 1000);
