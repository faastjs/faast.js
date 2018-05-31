import * as cloudify from "../src/cloudify";
import { checkFunctions } from "./expectations";
import * as funcs from "./functions";

let service: cloudify.Service;
let remote: cloudify.Promisified<typeof funcs>;

beforeAll(async () => {
    service = await cloudify.createService("google", require.resolve("./functions"));
    console.log(`Service created: ${service.name}`);
    remote = service.cloudifyAll(funcs);
}, 120 * 1000);

checkFunctions("Cloudify Google", () => remote);

afterAll(() => service.cleanup(), 120 * 1000);
