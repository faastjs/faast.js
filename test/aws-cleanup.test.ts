import * as aws from "aws-sdk";
import * as cloudify from "../src/cloudify";
import { getLogGroupName } from "../src/aws/aws-cloudify";
import * as functions from "./functions";
import { checkResourcesCleanedUp } from "./util";

// Avoid dependency on aws-cloudify module, which can cause a circular
// dependency on cloudify, and from there, problems with module resolution.
function quietly<D, E>(request: aws.Request<D, E>) {
    return request.promise().catch(_ => {});
}

export async function getAWSResources(func: cloudify.AWSLambda) {
    const { lambda, sns, sqs, s3 } = func.state.services;
    const {
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
    } = func.state.resources;

    const _exhaustiveCheck: Required<typeof rest> = {};

    const functionResult = await quietly(
        lambda.getFunctionConfiguration({ FunctionName })
    );

    const snsResult = await quietly(
        sns.getTopicAttributes({ TopicArn: RequestTopicArn! })
    );

    const sqsResult = await quietly(
        sqs.getQueueAttributes({ QueueUrl: ResponseQueueUrl! })
    );

    const subscriptionResult = await quietly(
        sns.listSubscriptionsByTopic({ TopicArn: RequestTopicArn! })
    );

    const s3Result = await quietly(s3.getObject({ Bucket: s3Bucket!, Key: s3Key! }));

    if (
        logGroupName ||
        RoleName ||
        SNSLambdaSubscriptionArn ||
        region ||
        ResponseQueueArn
    ) {
        // ignore
    }

    return {
        functionResult,
        snsResult,
        sqsResult,
        subscriptionResult,
        s3Result
    };
}

async function checkLogGroupCleanedUp(func: cloudify.AWSLambda) {
    const { cloudwatch } = func.state.services;
    const { FunctionName } = func.state.resources;

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
        await checkResourcesCleanedUp(await getAWSResources(func));
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
        await checkResourcesCleanedUp(await getAWSResources(func));
        await checkLogGroupCleanedUp(func);
    },
    90 * 1000
);
