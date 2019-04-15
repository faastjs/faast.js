import test from "ava";
import { IAM } from "aws-sdk";
import * as uuidv4 from "uuid/v4";
import { faastAws } from "../index";
import {
    deleteRole,
    ensureRole,
    createAwsApis,
    deleteResources
} from "../src/aws/aws-faast";
import * as funcs from "./fixtures/functions";
import { sleep } from "../src/shared";
import { title } from "./fixtures/util";

/**
 * The policies tested here should match those in the documentation at
 * {@link AwsOptions.RoleName}.
 */
test(title("aws", "custom role"), async t => {
    t.plan(1);
    const iam = new IAM();
    const uuid = uuidv4();
    const RoleName = `faast-test-custom-role-${uuid}`;
    let faastModule;
    let PolicyArn;
    try {
        const AssumeRolePolicyDocument = JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Principal: { Service: "lambda.amazonaws.com" },
                    Action: "sts:AssumeRole",
                    Effect: "Allow"
                }
            ]
        });
        await iam
            .createRole({
                AssumeRolePolicyDocument,
                RoleName,
                Description: "test custom role for lambda functions created by faast"
            })
            .promise();

        const PolicyDocument = JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: ["logs:*"],
                    Resource: "arn:aws:logs:*:*:log-group:faast-*"
                },
                {
                    Effect: "Allow",
                    Action: ["sqs:*"],
                    Resource: "arn:aws:sqs:*:*:faast-*"
                }
            ]
        });

        const executionPolicy = await iam
            .createPolicy({
                Description: "test faast custom role policy",
                PolicyName: RoleName,
                PolicyDocument
            })
            .promise();

        PolicyArn = executionPolicy.Policy!.Arn!;
        await iam.attachRolePolicy({ RoleName, PolicyArn }).promise();

        await sleep(30 * 1000);

        faastModule = await faastAws(funcs, "./fixtures/functions", {
            RoleName,
            gc: false
        });
        t.is(await faastModule.functions.identity("hello"), "hello");
    } finally {
        faastModule && (await faastModule.cleanup());
        await deleteRole(RoleName, iam);
        PolicyArn && (await iam.deletePolicy({ PolicyArn }).promise());
    }
});

test(title("aws", "unit test ensureRole"), async t => {
    let roleArn: string | undefined;
    t.plan(3);
    const RoleName = `faast-test-ensureRole-${uuidv4()}`;
    try {
        const services = await createAwsApis("us-west-2");
        roleArn = await ensureRole(RoleName, services, true);
        t.truthy(roleArn);
        const roleArn2 = await ensureRole(RoleName, services, true);
        t.is(roleArn, roleArn2);
    } finally {
        const services = await createAwsApis("us-west-2");
        await deleteResources({ RoleName }, services, () => {});
        const role = await services.iam
            .getRole({ RoleName })
            .promise()
            .catch(_ => {});
        t.true(role === undefined);
    }
});
