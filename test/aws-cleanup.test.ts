import test from "ava";
import { AwsLambda, faast } from "../index";
import { checkResourcesCleanedUp, quietly } from "./fixtures/util";
import * as uuid from "uuid/v4";

export async function getAWSResources(func: AwsLambda) {
    const { lambda, sns, sqs } = func.state.services;
    const {
        FunctionName,
        RoleName,
        region,
        SNSLambdaSubscriptionArn,
        RequestTopicArn,
        ResponseQueueUrl,
        ResponseQueueArn,
        logGroupName,
        layer,
        ...rest
    } = func.state.resources;

    const _exhaustiveCheck: Required<typeof rest> = {};

    const functionResult = await quietly(
        lambda.getFunctionConfiguration({ FunctionName }).promise()
    );

    const layerResult =
        layer &&
        (await quietly(
            lambda
                .getLayerVersion({
                    LayerName: layer!.LayerName,
                    VersionNumber: layer!.Version
                })
                .promise()
        ));

    const snsResult = await quietly(
        sns.getTopicAttributes({ TopicArn: RequestTopicArn! }).promise()
    );
    const sqsResult = await quietly(
        sqs.getQueueAttributes({ QueueUrl: ResponseQueueUrl! }).promise()
    );

    const subscriptionResult = await quietly(
        sns.listSubscriptionsByTopic({ TopicArn: RequestTopicArn! }).promise()
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
        layerResult
    };
}
test("remote aws cleanup removes ephemeral resources", async t => {
    const func = await faast("aws", {}, "./fixtures/functions", {
        mode: "queue",
        gc: false
    });
    await func.cleanup({ deleteCaches: true });
    await checkResourcesCleanedUp(t, await getAWSResources(func));
});

test("remote aws cleanup removes lambda layers", async t => {
    const func = await faast("aws", {}, "./fixtures/functions", {
        packageJson: {
            name: uuid(),
            version: "0.0.2",
            description: "aws cleanup layer test",
            repository: "foo",
            license: "ISC",
            dependencies: {
                tslib: "^1.9.1"
            }
        },
        gc: false
    });
    await func.cleanup({ deleteCaches: true });
    await checkResourcesCleanedUp(t, await getAWSResources(func));
});
