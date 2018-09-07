import * as sys from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as awsCloudify from "../src/aws/aws-cloudify";
import * as googleCloudify from "../src/google/google-cloudify";
import { disableWarnings, enableWarnings, log, warn } from "../src/log";
import * as funcs from "./functions";
import * as cloudify from "../src/cloudify";

export function checkCosts(description: string, cloudProvider: cloudify.CloudProvider) {
    describe(description, () => {
        let remote: cloudify.Promisified<typeof funcs>;
        let lambda: cloudify.AnyCloudFunction;

        beforeAll(async () => {
            try {
                const cloud = cloudify.create(cloudProvider);
                const options = {
                    timeout: 30,
                    memorySize: 512
                };
                lambda = await cloud.createFunction("./functions", options);
                remote = lambda.cloudifyAll(funcs);
            } catch (err) {
                warn(err);
            }
        }, 90 * 1000);

        afterAll(async () => {
            await lambda.cleanup();
            // await lambda.stop();
        }, 60 * 1000);

        test(
            "costs",
            async () => {
                await remote.hello("there");
                const costs = await lambda.costEstimate();
                console.log("%O", costs);
                console.log(`total: ${cloudify.estimateTotalCosts(costs)}`);
            },
            120 * 1000
        );
    });
}

checkCosts("AWS costs", "aws");
