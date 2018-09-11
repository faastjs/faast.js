import * as sys from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as awsCloudify from "../src/aws/aws-cloudify";
import * as googleCloudify from "../src/google/google-cloudify";
import { disableWarnings, enableWarnings, log, warn } from "../src/log";
import * as funcs from "./functions";
import * as cloudify from "../src/cloudify";
import { sleep } from "../src/shared";

export function checkCosts(description: string, cloudProvider: cloudify.CloudProvider) {
    describe(description, () => {
        let remote: cloudify.Promisified<typeof funcs>;
        let lambda: cloudify.AnyCloudFunction;

        beforeAll(async () => {
            try {
                const cloud = cloudify.create(cloudProvider);
                lambda = await cloud.createFunction("./functions", {
                    timeout: 30,
                    memorySize: 512,
                    useQueue: true
                });
                remote = lambda.cloudifyAll(funcs);
                lambda.setLogger(console.log);
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
                await remote.hello("there");
                await remote.hello("there");
                await remote.hello("there");
                await remote.hello("there");

                const costs = await lambda.costEstimate();
                console.log(`${costs}`);
                console.log(`total: ${costs.estimateTotal()}`);
            },
            120 * 1000
        );
    });
}

// checkCosts("AWS costs", "aws");
checkCosts("Google costs", "google");
// checkCosts("immediate", "immediate");
// checkCosts("childprocess", "childprocess");
