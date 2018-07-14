import * as aws from "aws-sdk";
import { PromiseResult } from "aws-sdk/lib/request";
import humanStringify from "human-stringify";
import { Readable } from "stream";
import * as uuidv4 from "uuid/v4";
import { CloudFunctionImpl, CloudImpl, CreateFunctionOptions } from "../cloudify";
import { Funnel } from "../funnel";
import { log } from "../log";
import { packer, PackerOptions, PackerResult } from "../packer";
import * as cloudqueue from "../queue";
import { FunctionCall, FunctionReturn, sleep } from "../shared";
import {
    createSNSTopic,
    createSQSQueue,
    isControlMessage,
    publishSNS,
    publishSQSControlMessage,
    receiveDLQMessages,
    receiveMessages,
    sqsMessageAttribute,
    createDLQ
} from "./aws-queue";

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
    packerOptions?: Partial<PackerOptions>;
}

export interface AWSResources {
    FunctionName: string;
    RoleName: string;
    rolePolicy: RoleHandling;
    logGroupName: string;
    region: string;
    ResponseQueueUrl?: string;
    RequestTopicArn?: string;
    SNSLambdaSubscriptionArn?: string;
    DLQUrl?: string;
}

export interface AWSServices {
    readonly lambda: aws.Lambda;
    readonly cloudwatch: aws.CloudWatchLogs;
    readonly iam: aws.IAM;
    readonly sqs: aws.SQS;
    readonly sns: aws.SNS;
}

type AWSCloudQueueState = cloudqueue.StateWithMessageType<aws.SQS.Message>;
type AWSCloudQueueImpl = cloudqueue.QueueImpl<aws.SQS.Message>;
type AWSInvocationResponse = PromiseResult<aws.Lambda.InvocationResponse, aws.AWSError>;

export interface State {
    resources: AWSResources;
    services: AWSServices;
    callFunnel: Funnel<AWSInvocationResponse>;
    queueState?: AWSCloudQueueState;
}

export const Impl: CloudImpl<Options, State> = {
    name: "aws",
    initialize,
    cleanupResources,
    pack,
    translateOptions,
    getFunctionImpl
};

export const LambdaImpl: CloudFunctionImpl<State> = {
    name: "aws",
    callFunction,
    cleanup,
    cancelWithoutCleanup,
    getResourceList,
    setConcurrency
};

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
    memorySize: 256,
    useQueue: true,
    awsLambdaOptions: {},
    packerOptions: {}
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

export async function pollAWSRequest<T>(
    n: number,
    description: string,
    fn: () => aws.Request<T, aws.AWSError>
) {
    let duration = 1000;
    for (let i = 1; i < n; i++) {
        log(`Polling ${description}...`);
        const result = await quietly(fn());
        if (result) {
            return result;
        }
        await sleep(duration);
        if (duration < 5000) {
            duration += 1000;
        }
    }
    try {
        return await fn().promise();
    } catch (err) {
        log(err);
        throw err;
    }
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
        packerOptions = {},
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

    async function createFunction(DLQArn?: string) {
        const roleResponse = await createLambdaRole(RoleName, PolicyArn, services);
        await addNoCreateLogPolicyToRole(RoleName, noCreateLogGroupPolicy, services);
        const { archive } = await pack(fModule, packerOptions);
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
            DeadLetterConfig: {
                TargetArn: DLQArn
            },
            ...rest,
            ...awsLambdaOptions
        };
        log(`createFunctionRequest: ${humanStringify(createFunctionRequest)}`);
        const nRetries = rolePolicy === "createTemporaryRole" ? 100 : 3;
        const func = await pollAWSRequest(nRetries, "creating function", () =>
            lambda.createFunction(createFunctionRequest)
        );
        log(`Created function ${func.FunctionName}, FunctionArn: ${func.FunctionArn}`);
        return func;
    }

    const state: State = {
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
        log(`Creating DLQ`);
        const { DLQArn, DLQUrl } = await createDLQ(FunctionName, sqs);
        state.resources.DLQUrl = DLQUrl;
        await createLogGroup(logGroupName, services);
        log(`Creating function`);
        const func = await createFunction(DLQArn);
        if (useQueue) {
            const awsQueueImpl = await createQueueImpl(
                state,
                FunctionName,
                func.FunctionArn!
            );
            state.queueState = cloudqueue.initializeCloudFunctionQueue(awsQueueImpl);
        }
        return state;
    } catch (err) {
        log(`ERROR: ${err}`);
        await cleanup(state);
        throw err;
    }
}

async function callFunctionHttps(
    lambda: aws.Lambda,
    FunctionName: string,
    callRequest: FunctionCall,
    callFunnel: Funnel<AWSInvocationResponse>
) {
    let returned: FunctionReturn;
    let rawResponse: AWSInvocationResponse;
    const request: aws.Lambda.Types.InvocationRequest = {
        FunctionName,
        LogType: "Tail",
        Payload: JSON.stringify(callRequest)
    };
    rawResponse = await callFunnel.push(() => lambda.invoke(request).promise());
    if (rawResponse.FunctionError) {
        if (rawResponse.LogResult) {
            log(Buffer.from(rawResponse.LogResult!, "base64").toString());
        }
        let message = rawResponse.Payload as string;
        if (message && message.match(/Process exited before completing/)) {
            message += " (cloudify: possibly out of memory)";
        }
        returned = {
            type: "error",
            CallId: callRequest.CallId,
            rawResponse,
            value: new Error(message)
        };
    } else {
        returned = JSON.parse(rawResponse.Payload as string);
        returned.rawResponse = rawResponse;
    }
    return returned;
}

async function callFunction(state: State, callRequest: FunctionCall) {
    if (state.queueState) {
        return cloudqueue.enqueueCallRequest(
            state.queueState,
            callRequest,
            state.resources.ResponseQueueUrl!
        );
    } else {
        const {
            callFunnel,
            services: { lambda },
            resources: { FunctionName }
        } = state;
        return callFunctionHttps(lambda, FunctionName, callRequest, callFunnel);
    }
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
        region,
        RequestTopicArn,
        ResponseQueueUrl,
        SNSLambdaSubscriptionArn,
        DLQUrl,
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
    if (RequestTopicArn) {
        log(`Deleting request queue topic: ${RequestTopicArn}`);
        await quietly(sns.deleteTopic({ TopicArn: RequestTopicArn }));
    }
    if (ResponseQueueUrl) {
        log(`Deleting response queue: ${ResponseQueueUrl}`);
        await quietly(sqs.deleteQueue({ QueueUrl: ResponseQueueUrl }));
    }
    if (DLQUrl) {
        log(`Deleting DLQ: ${DLQUrl}`);
        await quietly(sqs.deleteQueue({ QueueUrl: DLQUrl }));
    }
    await cancelPromise;
}

export async function pack(
    functionModule: string,
    options?: PackerOptions
): Promise<PackerResult> {
    return packer(
        {
            trampolineModule: require.resolve("./aws-trampoline"),
            functionModule
        },
        {
            webpackOptions: { externals: "aws-sdk" },
            ...options
        }
    );
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
    const { callFunnel } = state;
    callFunnel &&
        callFunnel
            .pendingFutures()
            .map(p => p.reject(new Error("Rejected pending request")));
    if (state.queueState) {
        await cloudqueue.stop(state.queueState);
    }
}

export async function setConcurrency(state: State, maxConcurrentExecutions: number) {
    const { lambda } = state.services;
    const { FunctionName } = state.resources;

    if (state.queueState) {
        await lambda
            .putFunctionConcurrency({
                FunctionName,
                ReservedConcurrentExecutions: maxConcurrentExecutions
            })
            .promise();
    } else {
        state.callFunnel.setMaxConcurrency(maxConcurrentExecutions);
    }
}

export function translateOptions({
    timeout,
    memorySize,
    cloudSpecific,
    useQueue,
    ...rest
}: CreateFunctionOptions<Options>): Options {
    const _exhaustiveCheck: Required<typeof rest> = {};
    return {
        timeout,
        memorySize,
        useQueue,
        ...cloudSpecific
    };
}

export function getFunctionImpl() {
    return LambdaImpl;
}

export async function createQueueImpl(
    state: State,
    FunctionName: string,
    FunctionArn: string
): Promise<AWSCloudQueueImpl> {
    const { sqs, sns, lambda } = state.services;
    const resources = state.resources;
    log(`Creating SNS request topic`);
    resources.RequestTopicArn = await createSNSTopic(sns, `${FunctionName}-Requests`);
    log(`Creating SQS response queue`);
    resources.ResponseQueueUrl = await createSQSQueue(
        `${FunctionName}-Responses`,
        60,
        sqs
    );
    log(`Adding SNS invoke permissions to function`);
    addSnsInvokePermissionsToFunction(FunctionName, resources.RequestTopicArn!, lambda);
    log(`Subscribing SNS to invoke lambda function`);
    const snsResponse = await sns
        .subscribe({
            TopicArn: resources.RequestTopicArn,
            Protocol: "lambda",
            Endpoint: FunctionArn
        })
        .promise();
    resources.SNSLambdaSubscriptionArn = snsResponse.SubscriptionArn!;

    return {
        getMessageAttribute: (message, attr) => sqsMessageAttribute(message, attr),
        pollResponseQueueMessages: () =>
            receiveMessages(sqs, resources.ResponseQueueUrl!),
        getMessageBody: message => message.Body || "",
        description: () => resources.ResponseQueueUrl!,
        publishRequestMessage: call => publishSNS(sns, resources.RequestTopicArn!, call),
        publishReceiveQueueControlMessage: type =>
            publishSQSControlMessage(type, sqs, resources.ResponseQueueUrl!),
        publishDLQControlMessage: type =>
            publishSQSControlMessage(type, sqs, resources.DLQUrl!),
        isControlMessage: (message, type) => isControlMessage(message, type),
        pollErrorQueue: () => receiveDLQMessages(sqs, resources.DLQUrl!)
    };
}

function addSnsInvokePermissionsToFunction(
    FunctionName: string,
    RequestTopicArn: string,
    lambda: aws.Lambda
) {
    return lambda
        .addPermission({
            FunctionName,
            Action: "lambda:invokeFunction",
            Principal: "sns.amazonaws.com",
            StatementId: `${FunctionName}-Invoke`,
            SourceArn: RequestTopicArn
        })
        .promise();
}
