import * as faast from "../index";
import test from "ava";
import { quietly, checkResourcesCleanedUp } from "./util";

export async function getAWSResources(func: faast.AwsLambda) {
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
        lambda.getFunctionConfiguration({ FunctionName }).promise()
    );
    const snsResult = await quietly(
        sns.getTopicAttributes({ TopicArn: RequestTopicArn! }).promise()
    );
    const sqsResult = await quietly(
        sqs.getQueueAttributes({ QueueUrl: ResponseQueueUrl! }).promise()
    );

    const subscriptionResult = await quietly(
        sns.listSubscriptionsByTopic({ TopicArn: RequestTopicArn! }).promise()
    );

    const s3Result = await quietly(
        s3.getObject({ Bucket: s3Bucket!, Key: s3Key! }).promise()
    );

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
test("remote aws removes ephemeral resources", async t => {
    const func = await faast.faast("aws", {}, "./functions", {
        mode: "queue",
        gc: false
    });
    await func.cleanup();
    await checkResourcesCleanedUp(t, await getAWSResources(func));
});

test("remote aws removes s3 buckets", async t => {
    const func = await faast.faast("aws", {}, "./functions", {
        packageJson: "test/fixtures/package.json",
        gc: false
    });
    await func.cleanup();
    await checkResourcesCleanedUp(t, await getAWSResources(func));
});
