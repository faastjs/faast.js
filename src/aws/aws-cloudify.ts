import * as aws from "aws-sdk";
import humanStringify from "human-stringify";
import { Readable } from "stream";
import * as uuidv4 from "uuid/v4";
import {
    AnyFunction,
    CreateFunctionOptions,
    Response,
    ResponsifiedFunction
} from "../cloudify";
import { Funnel } from "../funnel";
import { log } from "../log";
import { packer, PackerResult } from "../packer";
import { FunctionCall, FunctionReturn, sleep } from "../shared";
import { AWSFunctionQueue } from "./aws-queue";
import { pollAWSRequest } from "./aws-shared";
import * as cloudqueue from "../queue";

export type RoleHandling = "createTemporaryRole" | "createOrReuseCachedRole";

export interface Options {
    region?: string;
    PolicyArn?: string;
    rolePolicy?: RoleHandling;
    RoleName?: string;
    timeout?: number;
    memorySize?: number;
    useQueue?: boolean;
    awsLambdaOptions?: Partial<aws.Lambda.Types.CreateFunctionRequest>;
}

export interface AWSResources {
    FunctionName: string;
    RoleName: string;
    rolePolicy: RoleHandling;
    logGroupName: string;
    region: string;
    RequestTopicArn?: string;
    ResponseQueueUrl?: string;
    SNSLambdaSubscriptionArn?: string;
    SNSFeedbackRole?: string;
}

export interface AWSServices {
    readonly lambda: aws.Lambda;
    readonly cloudwatch: aws.CloudWatchLogs;
    readonly iam: aws.IAM;
    readonly sqs: aws.SQS;
    readonly sns: aws.SNS;
}

export const name: string = "aws";

export interface State {
    resources: AWSResources;
    services: AWSServices;
    queue?: AWSFunctionQueue;
    callFunnel: Funnel;
}

export function carefully<U>(arg: aws.Request<U, aws.AWSError>) {
    return arg.promise().catch(err => log(err));
}

export function quietly<U>(arg: aws.Request<U, aws.AWSError>) {
    return arg.promise().catch(_ => {});
}

function zipStreamToBuffer(zipStream: Readable): Promise<Buffer> {
    const buffers: Buffer[] = [];
    return new Promise((resolve, reject) => {
        zipStream.on("data", data => buffers.push(data as Buffer));
        zipStream.on("end", () => resolve(Buffer.concat(buffers)));
        zipStream.on("error", reject);
    });
}

export let defaults: Required<Options> = {
    region: "us-west-2",
    PolicyArn: "arn:aws:iam::aws:policy/AdministratorAccess",
    rolePolicy: "createOrReuseCachedRole",
    RoleName: "cloudify-cached-lambda-role",
    timeout: 60,
    memorySize: 128,
    useQueue: true,
    awsLambdaOptions: {}
};

export function createAWSApis(region: string): AWSServices {
    return {
        iam: new aws.IAM({ apiVersion: "2010-05-08", region }),
        lambda: new aws.Lambda({ apiVersion: "2015-03-31", region }),
        cloudwatch: new aws.CloudWatchLogs({ apiVersion: "2014-03-28", region }),
        sqs: new aws.SQS({ apiVersion: "2012-11-05", region }),
        sns: new aws.SNS({ apiVersion: "2010-03-31", region })
    };
}

async function createLambdaRole(
    RoleName: string,
    PolicyArn: string,
    services: AWSServices
) {
    const { iam } = services;
    const previousRole = await quietly(iam.getRole({ RoleName }));
    if (previousRole) {
        return previousRole;
    }
    log(`Creating role "${RoleName}" for cloudify trampoline function`);
    const AssumeRolePolicyDocument = JSON.stringify({
        Version: "2012-10-17",
        Statement: [
            {
                Principal: { Service: "lambda.amazonaws.com" },
                Action: "sts:AssumeRole",
                Effect: "Allow"
            }
        ]
    });
    const roleParams: aws.IAM.CreateRoleRequest = {
        AssumeRolePolicyDocument,
        RoleName,
        Description: "role for lambda functions created by cloudify",
        MaxSessionDuration: 3600
    };
    const roleResponse = await iam.createRole(roleParams).promise();
    await iam.attachRolePolicy({ RoleName, PolicyArn }).promise();
    return roleResponse;
}

async function addNoCreateLogPolicyToRole(
    RoleName: string,
    PolicyName: string,
    services: AWSServices
) {
    const { iam } = services;
    log(`Adding inline policy to not allow log group creation to role "${RoleName}"`);
    const NoCreateLogGroupPolicy = JSON.stringify({
        Version: "2012-10-17",
        Statement: [
            {
                Resource: "*",
                Action: "logs:CreateLogGroup",
                Effect: "Deny"
            }
        ]
    });

    await iam
        .putRolePolicy({
            RoleName,
            PolicyName,
            PolicyDocument: NoCreateLogGroupPolicy
        })
        .promise();
}

async function createLogGroup(logGroupName: string, services: AWSServices) {
    const { cloudwatch } = services;
    log(`Creating log group: ${logGroupName}`);
    const response = await carefully(cloudwatch.createLogGroup({ logGroupName }));
    if (response) {
        await carefully(
            cloudwatch.putRetentionPolicy({ logGroupName, retentionInDays: 1 })
        );
    } else {
        log(`Log group could not be created, proceeding without logs.`);
    }
    return response;
}

export async function initialize(fModule: string, options: Options = {}): Promise<State> {
    const nonce = uuidv4();
    log(`Nonce: ${nonce}`);

    let {
        region = defaults.region,
        PolicyArn = defaults.PolicyArn,
        rolePolicy = defaults.rolePolicy,
        RoleName = defaults.RoleName,
        timeout: Timeout = defaults.timeout,
        memorySize: MemorySize = defaults.memorySize,
        useQueue = defaults.useQueue,
        awsLambdaOptions = {},
        ...rest
    } = options;
    log(`Creating AWS APIs`);
    const services = createAWSApis(region);
    const { lambda, iam, cloudwatch, sqs, sns } = services;
    const FunctionName = `cloudify-${nonce}`;
    const logGroupName = `/aws/lambda/${FunctionName}`;
    const noCreateLogGroupPolicy = `cloudify-deny-create-log-group-policy`;

    if (rolePolicy === "createTemporaryRole") {
        RoleName = `cloudify-role-${nonce}`;
    }

    async function createFunction() {
        let roleResponse = await createLambdaRole(RoleName, PolicyArn, services);
        await addNoCreateLogPolicyToRole(RoleName, noCreateLogGroupPolicy, services);
        const { archive } = await pack(fModule);
        const previous = await quietly(lambda.getFunction({ FunctionName }));
        if (previous) {
            throw new Error("Function name hash collision");
        }
        const createFunctionRequest: aws.Lambda.Types.CreateFunctionRequest = {
            FunctionName,
            Role: roleResponse.Role.Arn,
            Runtime: "nodejs6.10",
            Handler: useQueue ? "index.snsTrampoline" : "index.trampoline",
            Code: { ZipFile: await zipStreamToBuffer(archive) },
            Description: "cloudify trampoline function",
            Timeout,
            MemorySize,
            ...rest,
            ...awsLambdaOptions
        };
        log(`createFunctionRequest: ${humanStringify(createFunctionRequest)}`);
        const func = await pollAWSRequest(100, "creating function", () =>
            lambda.createFunction(createFunctionRequest)
        );
        log(`Created function ${func.FunctionName}, FunctionArn: ${func.FunctionArn}`);
        return func;
    }

    let state: State = {
        resources: {
            FunctionName,
            RoleName,
            rolePolicy,
            logGroupName,
            region
        },
        services: { lambda, cloudwatch, iam, sqs, sns },
        callFunnel: new Funnel()
    };

    try {
        await createLogGroup(logGroupName, services);
        const { resources } = state;
        log(`Creating function`);
        const func = await createFunction();
        if (useQueue) {
            state.queue = await AWSFunctionQueue.initialize(
                services,
                FunctionName,
                func.FunctionArn!,
                rolePolicy
            );
        }
        return state;
    } catch (err) {
        log(`ERROR: ${err}`);
        await cleanup(state);
        throw err;
    }
}

interface QueuedCall {
    fname: string;
    args: any[];
}

async function callFunction(state: State, call: QueuedCall) {
    const CallId = uuidv4();
    const { FunctionName, RequestTopicArn, ResponseQueueUrl } = state.resources;
    let callArgs: FunctionCall = {
        name: call.fname,
        args: call.args,
        CallId,
        ResponseQueueUrl
    };
    const callArgsStr = JSON.stringify(callArgs);
    log(`Calling cloud function "${call.fname}" with args: ${callArgsStr}`, "");
    const { lambda } = state.services;
    let returned: FunctionReturn | undefined;
    let error: Error | undefined;
    let rawResponse: any;
    if (state.queue) {
        const { sns } = state.services;
        const responsePromise = await cloudqueue.enqueueCallRequest(state, callArgs);
        ({ returned, rawResponse } = await responsePromise);
    } else {
        const request: aws.Lambda.Types.InvocationRequest = {
            FunctionName: FunctionName,
            LogType: "Tail",
            Payload: callArgsStr
        };
        log(`Invocation request: ${humanStringify(request)}`);
        const { callFunnel } = state;
        rawResponse = await callFunnel.push(() => lambda.invoke(request).promise());
        log(`  returned: ${humanStringify(rawResponse)}`);
        log(`  requestId: ${rawResponse.$response.requestId}`);
        if (rawResponse.FunctionError) {
            if (rawResponse.LogResult) {
                log(Buffer.from(rawResponse.LogResult!, "base64").toString());
            }
            error = new Error(rawResponse.Payload as string);
        }
        returned =
            !error && rawResponse.Payload && JSON.parse(rawResponse.Payload as string);
    }

    if (returned && returned.type === "error") {
        const errValue = returned.value;
        error = new Error(errValue.message);
        error.name = errValue.name;
        error.stack = errValue.stack;
    }
    const value = !error && returned && returned.value;
    let rv: Response<ReturnType<any>> = { value, error, rawResponse };
    return rv;
}

export function cloudifyWithResponse<F extends AnyFunction>(
    state: State,
    fn: F
): ResponsifiedFunction<F> {
    const responsifedFunc = async (...args: any[]) => {
        return callFunction(state, {
            fname: fn.name,
            args
        });
    };
    return responsifedFunc as any;
}

export async function deleteRole(RoleName: string, iam: aws.IAM) {
    const policies = await carefully(iam.listAttachedRolePolicies({ RoleName }));
    const AttachedPolicies = (policies && policies.AttachedPolicies) || [];
    await Promise.all(
        AttachedPolicies.map(p => p.PolicyArn!).map(PolicyArn =>
            carefully(iam.detachRolePolicy({ RoleName, PolicyArn }))
        )
    ).catch(log);
    const rolePolicyListResponse = await carefully(iam.listRolePolicies({ RoleName }));
    const RolePolicies =
        (rolePolicyListResponse && rolePolicyListResponse.PolicyNames) || [];
    await Promise.all(
        RolePolicies.map(PolicyName =>
            carefully(iam.deleteRolePolicy({ RoleName, PolicyName }))
        )
    ).catch(log);
    await carefully(iam.deleteRole({ RoleName }));
}

export type PartialState = Partial<State> & Pick<State, "services" | "resources">;

export async function cleanup(state: PartialState) {
    const {
        FunctionName,
        RoleName,
        logGroupName,
        rolePolicy,
        RequestTopicArn,
        ResponseQueueUrl,
        SNSLambdaSubscriptionArn,
        region,
        SNSFeedbackRole,
        ...rest
    } = state.resources;
    const _exhaustiveCheck: Required<typeof rest> = {};

    const { cloudwatch, iam, lambda, sqs, sns } = state.services;
    log(`Cleaning up cloudify state`);
    if (SNSLambdaSubscriptionArn) {
        log(`Deleting request queue subscription to lambda`);
        await quietly(sns.unsubscribe({ SubscriptionArn: SNSLambdaSubscriptionArn }));
    }
    const cancelPromise = cancelWithoutCleanup(state);
    if (FunctionName) {
        log(`Deleting function: ${FunctionName}`);
        await quietly(lambda.deleteFunction({ FunctionName }));
    }
    if (logGroupName) {
        log(`Deleting log group: ${logGroupName}`);
        await quietly(cloudwatch.deleteLogGroup({ logGroupName }));
    }
    if (RoleName && rolePolicy === "createTemporaryRole") {
        log(`Deleting temporary role: ${RoleName}`);
        await deleteRole(RoleName, iam);
    }
    await cancelPromise;
}

export async function pack(functionModule: string): Promise<PackerResult> {
    return packer({
        trampolineModule: require.resolve("./aws-trampoline"),
        functionModule,
        packageBundling: "bundleNodeModules",
        webpackOptions: { externals: "aws-sdk" }
    });
}

export function getResourceList(state: State) {
    return JSON.stringify(state.resources);
}

export function cleanupResources(resourceString: string) {
    const resources: AWSResources = JSON.parse(resourceString);
    if (!resources.region) {
        throw new Error("Resources missing 'region'");
    }
    const services = createAWSApis(resources.region);
    return cleanup({
        resources,
        services
    });
}

export async function cancelWithoutCleanup(state: PartialState) {
    const { sqs } = state.services;
    const { ResponseQueueUrl } = state.resources;
    const { callFunnel } = state;
    let tasks = [];
    callFunnel && callFunnel.clear();
    if (state.queue) {
        tasks.push(cloudqueue.stop(state));
    }
    await Promise.all(tasks);
}

export async function setConcurrency(state: State, maxConcurrentExecutions: number) {
    const { lambda } = state.services;
    const { FunctionName } = state.resources;

    if (state.queue) {
        await lambda
            .putFunctionConcurrency({
                FunctionName,
                ReservedConcurrentExecutions: maxConcurrentExecutions
            })
            .promise();
    } else {
        if (state.callFunnel) {
            state.callFunnel.setMaxConcurrency(maxConcurrentExecutions);
        } else {
            state.callFunnel = new Funnel(maxConcurrentExecutions);
        }
    }
}

export function translateOptions({
    timeout,
    memorySize,
    cloudSpecific
}: CreateFunctionOptions<Options>): Options {
    return {
        timeout,
        memorySize,
        ...cloudSpecific
    };
}

export function getFunctionImpl() {
    return exports;
}
