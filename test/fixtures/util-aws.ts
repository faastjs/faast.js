import { AwsFaastModule } from "../../index";

export function quietly<T>(p: Promise<T>) {
    return p
        .then(x => {
            // Occassionally AWS will return an invalid response with a
            // ResponseMetadata field when an object is recently destroyed. We
            // check for this case and return undefined as if the object were
            // not there. This fixes occassional testsuite failures.
            const { ResponseMetadata, $metadata, ...rest } = x as any;
            if (Object.keys(rest).length === 0) {
                return;
            }
            return x;
        })
        .catch(_ => {});
}

export async function getAWSResources(mod: AwsFaastModule, includeLogGroup = false) {
    const { lambda, sns, sqs, s3, cloudwatch } = mod.state.services;
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
        lambda.getFunctionConfiguration({ FunctionName })
    );

    const layerResult =
        layer &&
        (await quietly(
            lambda.getLayerVersion({
                LayerName: layer!.LayerName,
                VersionNumber: layer!.Version
            })
        ));

    const snsResult = await quietly(
        sns.getTopicAttributes({ TopicArn: RequestTopicArn! })
    );
    const sqsResult = await quietly(
        sqs.getQueueAttributes({ QueueUrl: ResponseQueueUrl! })
    );

    const subscriptionResult = await quietly(
        sns.listSubscriptionsByTopic({ TopicArn: RequestTopicArn! })
    );

    const s3Result = Bucket && (await quietly(s3.listObjectsV2({ Bucket })));

    const logGroupResult =
        includeLogGroup &&
        logGroupName &&
        (await quietly(
            cloudwatch.describeLogGroups({ logGroupNamePrefix: logGroupName })
        ));

    if (RoleName || SNSLambdaSubscriptionArn || region || ResponseQueueArn) {
        // ignore
    }

    return {
        logGroupResult: (logGroupResult && logGroupResult.logGroups![0]) || undefined,
        functionResult,
        snsResult,
        sqsResult,
        subscriptionResult,
        layerResult,
        s3Result
    };
}
