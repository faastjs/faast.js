import { quietly } from "../src/aws/aws-cloudify";
import * as cloudify from "../src/cloudify";

async function checkResourcesCleanedUp(func: cloudify.AWSLambda) {
    const {
        services: { lambda, iam, cloudwatch, sns, sqs },
        resources: {
            FunctionName,
            logGroupName,
            RoleName,
            rolePolicy,
            region,
            SNSLambdaSubscriptionArn,
            RequestTopicArn,
            ResponseQueueUrl,
            DLQUrl,
            ...rest
        }
    } = func.getState();

    const _exhaustiveCheck: Required<typeof rest> = {};

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

    if (DLQUrl) {
        const dlqResult = await quietly(sqs.getQueueAttributes({ QueueUrl: DLQUrl }));
        expect(dlqResult).toBeUndefined();
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
            useQueue: true,
            cloudSpecific: {
                rolePolicy: "createTemporaryRole"
            }
        });
        await func.cleanup();
        await checkResourcesCleanedUp(func);
    },
    60 * 1000
);
