import test from "ava";
import * as uuid from "uuid/v4";
import { faastAws, AwsFaastModule } from "../index";
import { checkResourcesCleanedUp, quietly } from "./fixtures/util";

export async function getAWSResources(mod: AwsFaastModule) {
    const { lambda, sns, sqs, s3 } = mod.state.services;
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
        Bucket,
        ...rest
    } = mod.state.resources;

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

    const s3Result = Bucket && (await quietly(s3.listObjectsV2({ Bucket }).promise()));

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
        layerResult,
        s3Result
    };
}
test("remote aws cleanup removes ephemeral resources", async t => {
    const func = await faastAws({}, "./fixtures/functions", {
        mode: "queue",
        gc: false
    });
    await func.cleanup({ deleteCaches: true });
    await checkResourcesCleanedUp(t, await getAWSResources(func));
});

test("remote aws cleanup removes lambda layers", async t => {
    const func = await faastAws({}, "./fixtures/functions", {
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
