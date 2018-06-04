import * as fs from "fs";
import * as cloudify from "../src/cloudify";
import { exec, unzipInDir } from "./util";
import * as funcs from "./functions";
import { checkFunctions } from "./functions-expected";
import { log } from "../src/log";

let emulator: cloudify.Google;
let cloudFunction: cloudify.CloudFunction<any>;
let remote: cloudify.Promisified<typeof funcs>;

beforeAll(async () => {
    emulator = cloudify.create("google-emulator");
    cloudFunction = await emulator.createFunction("./functions");
    console.log(`Service created: ${cloudFunction.cloudName}`);
    remote = cloudFunction.cloudifyAll(funcs);
}, 120 * 1000);

test("hello", async () => {
    const str = await remote.hello("Andy");
    expect(str).toBe("Hello Andy");
});

//checkFunctions("Google Emulator", () => remote);

//afterAll(() => cloudFunction.cleanup(), 120 * 1000);
