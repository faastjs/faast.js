import test from "ava";
import { IAM } from "aws-sdk";
import * as uuidv4 from "uuid/v4";
import { faastAws } from "../index";
import {
    deleteRole,
    ensureRole,
    createAwsApis,
    deleteResources,
    ensureRoleRaw
} from "../src/aws/aws-faast";
import * as funcs from "./fixtures/functions";
import { sleep } from "../src/shared";
import { title } from "./fixtures/util";
import { FaastError } from "../src/error";

/**
 * The policies tested here should match those in the documentation at
 * {@link AwsOptions.RoleName}.
 */
test(title("aws", "custom role"), async t => {
    t.plan(1);
    const iam = new IAM({ maxRetries: 0 });
    const uuid = uuidv4();
    const RoleName = `faast-test-custom-role-${uuid}`;
    let faastModule;
    let PolicyArn;
    let state = "initial";
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
        state = `creating role ${RoleName}`;
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

        state = "creating policy";
        const executionPolicy = await iam
            .createPolicy({
                Description: "test faast custom role policy",
                PolicyName: RoleName,
                PolicyDocument
            })
            .promise();

        state = "attaching role policy";
        PolicyArn = executionPolicy.Policy!.Arn!;
        await iam.attachRolePolicy({ RoleName, PolicyArn }).promise();

        await sleep(30 * 1000);

        state = "creating faastAws with custom role";
        faastModule = await faastAws(funcs, {
            RoleName,
            gc: "off"
        });

        state = "testing invocation";
        t.is(await faastModule.functions.identityString("hello"), "hello");
    } catch (err) {
        throw new FaastError(err, `Failed custom role test, last state: ${state}`);
    } finally {
        try {
            faastModule && (await faastModule.cleanup());
            await deleteRole(RoleName, iam);
            PolicyArn && (await iam.deletePolicy({ PolicyArn }).promise());
        } catch (err) {
            throw new FaastError(
                err,
                `Could not cleanup test role, last state: ${state}`
            );
        }
    }
});

test(title("aws", "unit test ensureRole"), async t => {
    let role: IAM.Role | undefined;
    t.plan(3);
    const RoleName = `faast-test-ensureRole-1-${uuidv4()}`;
    try {
        const services = await createAwsApis("us-west-2");
        role = await ensureRole(RoleName, services, true);
        t.truthy(role.Arn);
        const role2 = await ensureRole(RoleName, services, true);
        t.is(role.Arn, role2.Arn);
    } finally {
        const services = await createAwsApis("us-west-2");
        await deleteResources({ RoleName }, services, () => {});
        const role3 = await services.iam
            .getRole({ RoleName })
            .promise()
            .catch(_ => {});
        t.true(role3 === undefined);
    }
});

test(title("aws", "unit test missing role name"), async t => {
    const RoleName = `faast-test-ensureRole-2-${uuidv4()}`;
    t.plan(1);
    const services = await createAwsApis("us-west-2");
    try {
        await ensureRole(RoleName, services, false);
    } catch (err) {
        t.true(true);
    }
});

test(title("aws", "race condition in role creation"), async t => {
    const RoleName = `faast-test-ensureRole-3-${uuidv4()}`;
    t.plan(3);
    const services = await createAwsApis("us-west-2");
    const promises: Promise<IAM.Role>[] = [];
    try {
        for (let i = 0; i < 3; i++) {
            promises.push(ensureRoleRaw(RoleName, services, true));
        }
        const results = await Promise.all(promises);
        const Arn = results[0].Arn;
        results.forEach(role => t.is(role.Arn, Arn));
    } finally {
        await deleteResources({ RoleName }, services, () => {});
    }
});
