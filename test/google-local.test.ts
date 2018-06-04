import * as fs from "fs";
import * as cloudify from "../src/cloudify";
import { exec, unzipInDir } from "./util";
import * as funcs from "./functions";
import { checkFunctions } from "./functions-expected";
import { log } from "../src/log";

let emulator: cloudify.Google;
let cloudFunction: cloudify.GoogleCloudFunction;
let remote: cloudify.Promisified<typeof funcs>;

beforeAll(async () => {
    emulator = cloudify.create("google-emulator");
    cloudFunction = await emulator.createFunction("./functions");
    remote = cloudFunction.cloudifyAll(funcs);
}, 120 * 1000);

checkFunctions("Google Emulator", () => remote);

afterAll(() => cloudFunction.cleanup(), 120 * 1000);
