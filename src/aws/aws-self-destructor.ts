import * as aws from "aws-sdk";
import humanStringify from "human-stringify";
import { Readable } from "stream";
import {
    AnyFunction,
    CloudFunctionService,
    FunctionCall,
    FunctionReturn,
    Promisified,
    PromisifiedFunction,
    getConfigHash
} from "../cloudify";
import { log } from "../log";
import { PackerResult, packer } from "../packer";
import { createHash } from "crypto";

let f: aws.Lambda;

export async function selfDestructor(
    _event: any,
    context: any,
    callback: (err: Error | null, obj: object) => void
) {
    const region = "us-east-1";
    const PolicyArn = "arn:aws:iam::aws:policy/AWSLambdaExecute";
    const awsLambdaOptions = {};

    // This function deletes all traces of itself: role, logs, and function

    aws.config.region = region;
    const iam = new aws.IAM();
    const lambda = new aws.Lambda({ apiVersion: "2015-03-31" });
    const cloudwatch = new aws.CloudWatchLogs({ apiVersion: "2014-03-28" });

    const { functionName: FunctionName, logGroupName, logStreamName } = context;
    const config = await lambda.getFunctionConfiguration({ FunctionName }).promise();

    await lambda.deleteFunction({ FunctionName });
    await cloudwatch.deleteLogGroup({ logGroupName });
    const RoleName = config.Role!.split("/").pop();
    if (RoleName) {
        await iam.deleteRole({ RoleName });
    }
    callback(null, {});
}
