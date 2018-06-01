import * as cloudify from "../src/cloudify";
import { checkFunctions } from "./functions-expected";
import * as funcs from "./functions";

let cloud: cloudify.Google;
let cloudFunction: cloudify.CloudFunction;
let remote: cloudify.Promisified<typeof funcs>;

beforeAll(async () => {
    cloud = cloudify.create("google");
    cloudFunction = await cloud.createFunction("./functions");
    console.log(`Service created: ${cloudFunction.cloudName}`);
    remote = cloudFunction.cloudifyAll(funcs);
}, 120 * 1000);

checkFunctions("Cloudify Google", () => remote);

afterAll(() => cloudFunction.cleanup(), 120 * 1000);
