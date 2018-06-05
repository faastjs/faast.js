import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";
import { checkFunctions } from "./functions-expected";
import { test30 } from "./util";
import { CloudFunction } from "../src/cloudify";
import { isUndefined } from "util";
import {
    carefully,
    quietly,
    AWSVariables,
    cleanup,
    deleteRole,
    RoleHandling
} from "../src/aws/aws-cloudify";
import * as aws from "aws-sdk";

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

test30("removes ephemeral resources", async () => {
    const cloud = cloudify.create("aws");
    const func = await cloud.createFunction("./functions");
    await func.cleanup();
    await checkResourcesCleanedUp(func);
});

test30("removes ephemeral resources from a resource list", async () => {
    const cloud = cloudify.create("aws");
    const func = await cloud.createFunction("./functions");
    const resourceList = func.getResourceList();
    await cloud.cleanupResources(resourceList);
    await checkResourcesCleanedUp(func);
});

test30("removes temporary roles", async () => {
    const cloud = cloudify.create("aws");
    const func = await cloud.createFunction("./functions", {
        rolePolicy: "createTemporaryRole"
    });
    await func.cleanup();
    await checkResourcesCleanedUp(func);
});
