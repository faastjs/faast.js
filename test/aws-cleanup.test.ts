import * as cloudify from "../src/cloudify";
import { quietly } from "../src/aws/aws-cloudify";

async function checkResourcesCleanedUp(func: cloudify.AWSLambda) {
    const {
        services: { lambda, iam, cloudwatch },
        vars: { FunctionName, logGroupName, RoleName, rolePolicy }
    } = func.getState();

    const functionResult = await quietly(
        lambda.getFunctionConfiguration({ FunctionName })
    );
    expect(functionResult).toBeUndefined();

    const logResult = await quietly(
        cloudwatch.describeLogGroups({ logGroupNamePrefix: logGroupName })
    );
    expect(logResult && logResult.logGroups).toEqual([]);

    const roleResult = await quietly(iam.getRole({ RoleName }));
    if (rolePolicy === "createTemporaryRole") {
        expect(roleResult).toBeUndefined();
    } else {
        expect(roleResult && roleResult.Role.RoleName).toBe(RoleName);
    }
}

test(
    "removes ephemeral resources",
    async () => {
        const cloud = cloudify.create("aws");
        const func = await cloud.createFunction("./functions");
        await func.cleanup();
        await checkResourcesCleanedUp(func);
    },
    30 * 1000
);

test(
    "removes ephemeral resources from a resource list",
    async () => {
        const cloud = cloudify.create("aws");
        const func = await cloud.createFunction("./functions");
        const resourceList = func.getResourceList();
        await cloud.cleanupResources(resourceList);
        await checkResourcesCleanedUp(func);
    },
    30 * 1000
);

test(
    "removes temporary roles",
    async () => {
        const cloud = cloudify.create("aws");
        const func = await cloud.createFunction("./functions", {
            cloudSpecific: {
                rolePolicy: "createTemporaryRole"
            }
        });
        await func.cleanup();
        await checkResourcesCleanedUp(func);
    },
    30 * 1000
);
