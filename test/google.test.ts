import { CloudFunctionService, CloudifyGoogle, Promisified } from "../src/cloudify";
import { checkFunctions } from "./expectations";
import * as funcs from "./functions";

let service: CloudFunctionService;
let remote: Promisified<typeof funcs>;

beforeAll(async () => {
    service = await CloudifyGoogle.create(require.resolve("./functions"));
    console.log(`Service created: ${service.name}`);
    remote = service.cloudifyAll(funcs);
}, 120 * 1000);

checkFunctions("Cloudify Google", () => remote);

afterAll(() => service.cleanup(), 120 * 1000);
