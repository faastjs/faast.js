import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";
import { checkFunctions } from "./functions-expected";
import { test30 } from "./util";
import { CloudFunction } from "../src/cloudify";

describe("AWS cleanup", () => {
    test30("removes ephemeral resources", async () => {
        const cloud = cloudify.create("aws");
        const lambda = await cloud.createFunction("./functions");
        await lambda.cleanup();
    });
});
