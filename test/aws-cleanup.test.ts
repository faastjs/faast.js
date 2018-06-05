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
    deleteRole
} from "../src/aws/aws-cloudify";
import * as aws from "aws-sdk";

async function checkResourcesCleanedUp(func: cloudify.AWSLambda) {
    const {
        services: { lambda, iam, cloudwatch },
        vars: { FunctionName, logGroupName, RoleName }
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
    expect(roleResult).toBeUndefined();
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

test30("saves cached roles", async () => {
    const cloud = cloudify.create("aws");
    const func = await cloud.createFunction("./functions", {
        RoleName: "cloudify-cached-role-testing"
    });
    await func.cleanup();
    const {
        services: { iam },
        vars: { RoleName, noCreateLogGroupPolicy }
    } = func.getState();

    const roleResult = await quietly(iam.getRole({ RoleName }));
    expect(roleResult && roleResult.Role.RoleName).toBe(RoleName);

    await deleteRole(RoleName, noCreateLogGroupPolicy, iam);

    const roleResult2 = await quietly(iam.getRole({ RoleName }));
    expect(roleResult2).toBeUndefined();
});
