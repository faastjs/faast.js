import * as fs from "fs";
import {
    CloudFunctionService,
    CloudifyGoogle,
    Promisified,
    packGoogleCloudFunction
} from "../src/cloudify";
import { checkFunctions } from "./expectations";
import * as funcs from "./functions";

async function testPacker(serverModule: string) {
    const outputGoogle = fs.createWriteStream("dist-google.zip");
    const { archive: archiveGoogle } = await packGoogleCloudFunction(serverModule);
    archiveGoogle.pipe(outputGoogle);
}

let service: CloudFunctionService;
let remote: Promisified<typeof funcs>;

beforeAll(async () => {
    // await testPacker(require.resolve("./functions"));
    service = await CloudifyGoogle.create(require.resolve("./functions"));
    console.log(`Service created: ${service.name}`);
    remote = service.cloudifyAll(funcs);
}, 120 * 1000);

checkFunctions("Cloudify Google", () => remote);

afterAll(() => service.cleanup(), 120 * 1000);
