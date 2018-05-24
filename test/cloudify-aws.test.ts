import * as fs from "fs";
import {
    CloudFunctionService,
    CloudifyAWS,
    Promisified,
    packAWSLambdaFunction
} from "../src/cloudify";
import { checkFunctions } from "./expectations";
import * as funcs from "./functions";

async function testPacker(serverModule: string) {
    const outputAWS = fs.createWriteStream("dist-aws.zip");
    const { archive: archiveAWS } = await packAWSLambdaFunction(serverModule);
    archiveAWS.pipe(outputAWS);
}

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
