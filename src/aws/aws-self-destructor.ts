import * as aws from "aws-sdk";

const log = console.log;

export interface SelfDestructorOptions {
    keepRole?: boolean;
    keepLogs?: boolean;
    keepFunction?: boolean;
}

export async function selfDestructor(
    event: SelfDestructorOptions,
    context: any,
    callback: (err: Error | null, obj: object) => void
) {
    const region = "us-east-1";

    log(`Self destruct function executing`);
    log(`event: ${JSON.stringify(event)}`);
    const { keepRole = false, keepLogs = false, keepFunction = false } = event;

    // This function deletes all traces of itself: role, logs, and function

    const iam = new aws.IAM();
    const lambda = new aws.Lambda({ apiVersion: "2015-03-31" });
    const cloudwatch = new aws.CloudWatchLogs({ apiVersion: "2014-03-28" });

    const { functionName: FunctionName, logGroupName, logStreamName } = context;
    const config = await lambda.getFunctionConfiguration({ FunctionName }).promise();

    log(`Self function name: ${FunctionName}, logGroupName: ${logGroupName}`);

    if (!keepLogs) {
        log(`Deleting log group ${logGroupName}`);
        await cloudwatch.deleteLogGroup({ logGroupName }).promise();
    }
    if (!keepRole) {
        const RoleName = config.Role!.split("/").pop();
        log(`Deleting role name: ${RoleName}`);
        // 1. Why is the Log Group still there after deletion?
        // 2. How to remove the role completely.
        if (RoleName) {
            const { AttachedPolicies = [] } = await iam
                .listAttachedRolePolicies({ RoleName })
                .promise();

            await Promise.all(
                AttachedPolicies.map(policy =>
                    iam
                        .detachRolePolicy({
                            RoleName,
                            PolicyArn: policy.PolicyArn!
                        })
                        .promise()
                )
            );

            await iam.deleteRole({ RoleName }).promise();
        }
    }
    if (!keepFunction) {
        log(`Deleting function ${FunctionName}`);
        await lambda.deleteFunction({ FunctionName }).promise();
    }

    log(`Done.`);
    callback(null, {});
}
