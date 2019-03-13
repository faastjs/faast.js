import test from "ava";
import * as aws from "aws-sdk";
import * as uuidv4 from "uuid/v4";
import { faastAws } from "../index";
import { deleteRole } from "../src/aws/aws-faast";
import * as funcs from "./fixtures/functions";

/**
 * The policies tested here should match those in the documentation at
 * {@link AwsOptions.RoleName}.
 */
test("remote aws custom role", async t => {
    t.plan(1);
    const iam = new aws.IAM();
    let uuid = uuidv4();
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
