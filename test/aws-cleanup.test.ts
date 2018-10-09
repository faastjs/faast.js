import * as aws from "aws-sdk";
import * as cloudify from "../src/cloudify";
import { getLogGroupName } from "../src/aws/aws-cloudify";

// Avoid dependency on aws-cloudify module, which can cause a circular
// dependency on cloudify, and from there, problems with module resolution.
function quietly<D, E>(request: aws.Request<D, E>) {
    return request.promise().catch(_ => {});
}

async function checkResourcesCleanedUp(func: cloudify.AWSLambda) {
    const {
        services: { lambda, iam, sns, sqs, s3 },
        resources: {
            FunctionName,
            RoleName,
            region,
            SNSLambdaSubscriptionArn,
            RequestTopicArn,
            ResponseQueueUrl,
            ResponseQueueArn,
            s3Bucket,
            s3Key,
            logGroupName,
            ...rest
        }
    } = func.state;

    const _exhaustiveCheck: Required<typeof rest> = {};

    const functionResult = await quietly(
        lambda.getFunctionConfiguration({ FunctionName })
    );
    expect(functionResult).toBeUndefined();

    const roleResult = await quietly(iam.getRole({ RoleName }));
    expect(roleResult && roleResult.Role.RoleName).toBe(RoleName);

    if (RequestTopicArn) {
        const snsResult = await quietly(
            sns.getTopicAttributes({ TopicArn: RequestTopicArn })
        );
        expect(snsResult).toBeUndefined();
    }

    if (ResponseQueueUrl) {
        const sqsResult = await quietly(
            sqs.getQueueAttributes({ QueueUrl: ResponseQueueUrl })
        );
        expect(sqsResult).toBeUndefined();
    }

    if (SNSLambdaSubscriptionArn) {
        const snsResult = await quietly(
            sns.listSubscriptionsByTopic({ TopicArn: RequestTopicArn! })
        );
        expect(snsResult).toBeUndefined();
    }

    if (s3Bucket && s3Key) {
        const s3Result = await quietly(s3.getObject({ Bucket: s3Bucket, Key: s3Key }));
        expect(s3Result).toBeUndefined();
    }

    if (logGroupName) {
        // ignore
    }
}

async function checkLogGroupCleanedUp(func: cloudify.AWSLambda) {
    const {
        services: { cloudwatch },
        resources: { FunctionName }
    } = func.state;

    const logGroupResult = await quietly(
        cloudwatch.describeLogGroups({
            logGroupNamePrefix: getLogGroupName(FunctionName)
        })
    );
    expect(logGroupResult && logGroupResult.logGroups!.length).toBe(0);
}

test(
    "removes ephemeral resources",
    async () => {
        const cloud = cloudify.create("aws");
        const func = await cloud.createFunction("./functions", { useQueue: true });
        await func.cleanup();
        await checkResourcesCleanedUp(func);
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
        await checkResourcesCleanedUp(func);
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
        await checkResourcesCleanedUp(func);
    },
    90 * 1000
);

import * as functions from "./functions";

test(
    "garbage collector works for functions that are called",
    async () => {
        // Idea behind this test: create a cloudified function and make a call.
        // Then call stop() to leave the resources in place. Then create another
        // function and set its retention to 0, and have its garbage collector
        // clean up the first function. Verify the first function's resources
        // are cleaned up, which shows that the garbage collector did its job.
        const cloud = cloudify.create("aws");
        const func = await cloud.createFunction("./functions");
        const remote = func.cloudifyModule(functions);
        await new Promise(resolve => {
            func.setLogger(str => str.match(/REPORT RequestId/) && resolve());
            remote.hello("gc-test");
        });

        await func.stop();
        const func2 = await cloud.createFunction("./functions", {
            gc: true,
            retentionInDays: 0
        });

        const { logGroupName } = func.state.resources;
        const { cloudwatch } = func.state.services;
        const logStreamsResponse = await cloudwatch
            .describeLogStreams({ logGroupName })
            .promise();
        for (const { logStreamName } of logStreamsResponse.logStreams || []) {
            if (logStreamName) {
                await cloudwatch
                    .deleteLogStream({ logGroupName, logStreamName })
                    .promise();
            }
        }

        await func2.cleanup();
        await checkResourcesCleanedUp(func);
        await checkLogGroupCleanedUp(func);
    },
    120 * 1000
);

test(
    "garbage collector works for functions that are never called",
    async () => {
        const cloud = cloudify.create("aws");
        const func = await cloud.createFunction("./functions");
        await func.stop();
        const func2 = await cloud.createFunction("./functions", {
            gc: true,
            retentionInDays: 0
        });

        await func2.cleanup();
        await checkResourcesCleanedUp(func);
        await checkLogGroupCleanedUp(func);
    },
    90 * 1000
);
