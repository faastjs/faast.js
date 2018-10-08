import * as aws from "aws-sdk";
import * as cloudify from "../src/cloudify";

// Avoid dependency on aws-cloudify module, which can cause a circular
// dependency on cloudify, and from there, problems with module resolution.
function quietly<D, E>(request: aws.Request<D, E>) {
    return request.promise().catch(_ => {});
}

async function checkResourcesCleanedUp(func: cloudify.AWSLambda) {
    const {
        services: { lambda, iam, cloudwatch, sns, sqs, s3 },
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
