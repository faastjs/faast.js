import * as cloudify from "../src/cloudify";
import { checkResourcesCleanedUp, getAWSResources } from "./tests";

describe("aws cleanup", () => {
    test(
        "removes ephemeral resources",
        async () => {
            const cloud = cloudify.create("aws");
            const func = await cloud.createFunction("./functions", { mode: "queue" });
            await func.cleanup();
            await checkResourcesCleanedUp(await getAWSResources(func));
        },
        30 * 1000
    );

    test(
        "removes s3 buckets",
        async () => {
            const cloud = cloudify.create("aws");
            const func = await cloud.createFunction("./functions", {
                packageJson: "test/package.json"
            });
            await func.cleanup();
            await checkResourcesCleanedUp(await getAWSResources(func));
        },
        90 * 1000
    );
});
