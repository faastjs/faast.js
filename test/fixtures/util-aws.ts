import { AwsFaastModule } from "../../index";

export function quietly<T>(p: Promise<T>) {
    return p
        .then(x => {
            // Occassionally AWS will return an invalid response with a
            // ResponseMetadata field when an object is recently destroyed. We
            // check for this case and return undefined as if the object were
            // not there. This fixes occassional testsuite failures.
            const { ResponseMetadata, ...rest } = x as any;
            if (ResponseMetadata && Object.keys(rest).length === 0) {
                return;
            }
            return x;
        })
        .catch(_ => {});
}

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
