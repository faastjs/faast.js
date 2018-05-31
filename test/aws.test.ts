import * as cloudify from "../src/cloudify";
import { checkFunctions } from "./functions-expected";
import * as funcs from "./functions";

let service: cloudify.Service;
let remote: cloudify.Promisified<typeof funcs>;

beforeAll(async () => {
    service = await cloudify.createService("aws", require.resolve("./functions"), {
        RoleName: "cloudify-cached-role"
    });
    console.log(`Service created: ${service.name}`);
    remote = service.cloudifyAll(funcs);
}, 30 * 1000);

checkFunctions("Cloudify AWS", () => remote);

afterAll(() => service.cleanup(), 30 * 1000);
