import { CloudFunctionService, CloudifyAWS, Promisified } from "../src/cloudify";
import { checkFunctions } from "./expectations";
import * as funcs from "./functions";

let service: CloudFunctionService;
let remote: Promisified<typeof funcs>;

beforeAll(async () => {
    // await testPacker(require.resolve("./functions"));
    service = await CloudifyAWS.create(require.resolve("./functions"));
    console.log(`Service created: ${service.name}`);
    remote = service.cloudifyAll(funcs);
}, 30 * 1000);

checkFunctions("Cloudify AWS", () => remote);

afterAll(() => service.cleanup(), 30 * 1000);
