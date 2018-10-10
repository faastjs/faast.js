import * as cloudify from "../src/cloudify";
import { checkResourcesCleanedUp, getAWSResources } from "./util";

test(
    "removes ephemeral resources",
    async () => {
        const cloud = cloudify.create("aws");
        const func = await cloud.createFunction("./functions", { useQueue: true });
        await func.cleanup();
        await checkResourcesCleanedUp(await getAWSResources(func));
    },
    30 * 1000
);

test(
    "removes ephemeral resources from a resource list",
    async () => {
        const cloud = cloudify.create("aws");
        const func = await cloud.createFunction("./functions", { useQueue: true });
        const resourceList = await func.stop();
        await cloud.cleanupResources(resourceList);
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
