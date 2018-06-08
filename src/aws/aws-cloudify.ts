import * as aws from "aws-sdk";
import { AWSError, Request, SNS } from "aws-sdk";
import humanStringify from "human-stringify";
import { Readable } from "stream";
import * as uuidv4 from "uuid/v4";
import { AnyFunction, Response, ResponsifiedFunction } from "../cloudify";
import { log } from "../log";
import { PackerResult, packer } from "../packer";
import { FunctionCall, FunctionReturn } from "../shared";
import { PromiseResult } from "aws-sdk/lib/request";

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
    RequestTopicArn?: string;
    ResponseQueueUrl?: string;
    rolePolicy: RoleHandling;
    logGroupName: string;
    region: string;
    noCreateLogGroupPolicy: string;
    SNSLambdaSubscriptionArn?: string;
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
    useQueue?: boolean;
    promiseQueue?: { [MessageId: string]: Deferred<QueuedResponse<any>> };
    stopResultCollector?: boolean;
}

export function carefully<U>(arg: Request<U, AWSError>) {
    return arg.promise().catch(err => log(err));
}

export function quietly<U>(arg: Request<U, AWSError>) {
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

function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

let defaults: Required<Options> = {
    region: "us-east-1",
    PolicyArn: "arn:aws:iam::aws:policy/AdministratorAccess",
    rolePolicy: "createOrReuseCachedRole",
    RoleName: "cloudify-cached-role",
    timeout: 60,
    memorySize: 128,
    useQueue: true,
    awsLambdaOptions: {}
};

function createAWSApis(region: string): AWSServices {
    return {
        iam: new aws.IAM({ apiVersion: "2010-05-08", region }),
        lambda: new aws.Lambda({ apiVersion: "2015-03-31", region }),
        cloudwatch: new aws.CloudWatchLogs({ apiVersion: "2014-03-28", region }),
        sqs: new aws.SQS({ apiVersion: "2012-11-05", region }),
        sns: new aws.SNS({ apiVersion: "2010-03-31", region })
    };
}

async function createRole(RoleName: string, PolicyArn: string, services: AWSServices) {
    const { iam } = services;
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
    let roleResponse = await iam.createRole(roleParams).promise();
    await iam.attachRolePolicy({ RoleName, PolicyArn }).promise();
    await waitForRoleReadiness(roleResponse.Role, services);
    return roleResponse;
}

async function waitForRoleReadiness(Role: aws.IAM.Role, services: AWSServices) {
    const { lambda } = services;
    log(`Creating test function to ensure new role is ready for use`);
    const { archive } = await packer({
        trampolineModule: require.resolve("./aws-trampoline"),
        packageBundling: "bundleNodeModules",
        webpackOptions: { externals: "aws-sdk" }
    });
    const nonce = uuidv4();
    const FunctionName = `cloudify-testfunction-${nonce}`;
    const createFunctionRequest: aws.Lambda.Types.CreateFunctionRequest = {
        FunctionName,
        Role: Role.Arn,
        Runtime: "nodejs6.10",
        Handler: "index.trampoline",
        Code: { ZipFile: await zipStreamToBuffer(archive) }
    };
    let testfunc: aws.Lambda.FunctionConfiguration | void;
    await sleep(2000);
    for (let i = 0; i < 100; i++) {
        log(`Polling for role readiness...`);
        testfunc = await quietly(lambda.createFunction(createFunctionRequest));
        if (testfunc) {
            break;
        }
        await sleep(1000);
    }
    if (!testfunc) {
        throw new Error("Could not initialize lambda execution role");
    }
    log(`Role ready. Cleaning up.`);
    // XXX Need to garbage collect this test function more robustly.
    await lambda.deleteFunction({ FunctionName }).promise();
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

async function createQueue(QueueName: string, VTimeout: number, services: AWSServices) {
    const { sqs } = services;
    const response = await sqs
        .createQueue({
            QueueName,
            Attributes: { VisibilityTimeout: `${VTimeout}` }
        })
        .promise();
    return response.QueueUrl!;
    // XXX Need to set the VisibilityTimeout when the message is being processed but not finished yet.
}

async function createNotifier(Name: string, services: AWSServices) {
    const { sns } = services;
    const topic = await sns.createTopic({ Name }).promise();
    return topic.TopicArn!;
}

async function createLogGroup(logGroupName: string, services: AWSServices) {
    const { cloudwatch } = services;
    await cloudwatch.createLogGroup({ logGroupName });
    await cloudwatch.putRetentionPolicy({ logGroupName, retentionInDays: 1 });
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
    const services = createAWSApis(region);
    const { lambda, iam, cloudwatch, sqs, sns } = services;
    const FunctionName = `cloudify-${nonce}`;
    const logGroupName = `/aws/lambda/${FunctionName}`;
    const noCreateLogGroupPolicy = `cloudify-deny-create-log-group-policy`;

    const limits = await carefully(lambda.getAccountSettings());
    log(`Limits: ${humanStringify(limits)}`);

    if (rolePolicy === "createTemporaryRole") {
        RoleName = `cloudify-role-${nonce}`;
    }

    async function createFunction() {
        let roleResponse =
            (await iam.getRole({ RoleName }).promise()) ||
            (await createRole(RoleName, PolicyArn, services));
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
            Handler: useQueue ? "index.queueTrampoline" : "index.trampoline",
            Code: { ZipFile: await zipStreamToBuffer(archive) },
            Description: "cloudify trampoline function",
            Timeout,
            MemorySize,
            ...rest,
            ...awsLambdaOptions
        };
        log(`createFunctionRequest: ${humanStringify(createFunctionRequest)}`);
        const func = await lambda.createFunction(createFunctionRequest).promise();
        log(`Created function ${func.FunctionName}, FunctionArn: ${func.FunctionArn}`);
        return func.FunctionArn!;
    }

    let state: State = {
        useQueue,
        resources: {
            FunctionName,
            RoleName,
            rolePolicy,
            logGroupName,
            region,
            noCreateLogGroupPolicy
        },
        services: { lambda, cloudwatch, iam, sqs, sns }
    };

    try {
        await createLogGroup(logGroupName, services);
        let tasks = [createFunction()];
        if (useQueue) {
            tasks.push(createNotifier(`${FunctionName}-Requests`, services));
            tasks.push(createQueue(`${FunctionName}-Responses`, Timeout, services));
        }
        const [FunctionArn, RequestTopicArn, ResponseQueueUrl] = await Promise.all(tasks);
        state.resources = { ...state.resources, RequestTopicArn, ResponseQueueUrl };

        if (useQueue) {
            const snsRepsonse = await sns
                .subscribe({
                    TopicArn: RequestTopicArn,
                    Protocol: "lambda",
                    Endpoint: FunctionArn
                })
                .promise();
            log(`Created SNS subscription: ${snsRepsonse.SubscriptionArn}`);
            state.resources.SNSLambdaSubscriptionArn = snsRepsonse.SubscriptionArn!;
            state.stopResultCollector = false;
            state.promiseQueue = {};
            resultCollector(state);
        }
        return state;
    } catch (err) {
        log(`ERROR: ${err}`);
        await cleanup(state);
        throw err;
    }
}

interface QueuedResponse<T> {
    returned: T;
    rawResponse: any;
}

interface Deferred<T> {
    resolve: (arg?: T) => void;
    reject: (err?: any) => void;
    promise: Promise<T>;
}

async function resultCollector(state: State) {
    const { sqs } = state.services;
    const { ResponseQueueUrl } = state.resources;
    while (state.stopResultCollector !== true) {
        log(`Result collector polling...`);
        const rawResponse = await sqs
            .receiveMessage({
                QueueUrl: ResponseQueueUrl!,
                WaitTimeSeconds: 20,
                MaxNumberOfMessages: 10
            })
            .promise();
        const { Messages = [] } = rawResponse;
        let deletePromises = [];
        log(`  Received ${Messages.length} messages.`);
        for (const { Body, ReceiptHandle } of Messages) {
            if (Body) {
                const returned: FunctionReturn = JSON.parse(Body);
                const promise = state.promiseQueue![returned.CallId];
                if (!promise) {
                    log(`Promise not found for CallID: ${returned.CallId}`);
                } else {
                    promise.resolve({ returned, rawResponse });
                }
            }
            const deletePromise = carefully(
                sqs.deleteMessage({
                    QueueUrl: ResponseQueueUrl!,
                    ReceiptHandle: ReceiptHandle!
                })
            );
            deletePromises.push(deletePromise);
        }
        await Promise.all(deletePromises);
    }
}

function enqueueCallRequest(state: State, CallId: string): Deferred<any> {
    let resolver!: (arg?: any) => void;
    let rejector!: (err?: any) => void;
    const promise = new Promise<any>((resolve, reject) => {
        resolver = resolve;
        rejector = reject;
    });
    const deferred: Deferred<any> = {
        resolve: resolver,
        reject: rejector,
        promise
    };
    state.promiseQueue![CallId] = deferred;
    return deferred;
}

export function cloudifyWithResponse<F extends AnyFunction>(
    state: State,
    fn: F
): ResponsifiedFunction<F> {
    const responsifedFunc = async (...args: any[]) => {
        const CallId = uuidv4();
        const { FunctionName, RequestTopicArn, ResponseQueueUrl } = state.resources;
        let callArgs: FunctionCall = {
            name: fn.name,
            args,
            CallId,
            ResponseQueueUrl
        };
        const callArgsStr = JSON.stringify(callArgs);
        log(`Calling cloud function "${fn.name}" with args: ${callArgsStr}`, "");
        const request: aws.Lambda.Types.InvocationRequest = {
            FunctionName: FunctionName,
            LogType: "Tail",
            Payload: callArgsStr
        };
        log(`Invocation request: ${humanStringify(request)}`);
        const { sns, lambda } = state.services;
        let returned: FunctionReturn | undefined;
        let error: Error | undefined;
        let rawResponse: any;
        if (state.useQueue) {
            const queueResponse = await enqueueCallRequest(state, CallId).promise;
            await sns
                .publish({ TopicArn: RequestTopicArn, Message: JSON.stringify(request) })
                .promise();
            ({ returned, rawResponse } = queueResponse);
        } else {
            rawResponse = await lambda.invoke(request).promise();
            log(`  returned: ${humanStringify(rawResponse)}`);
            log(`  requestId: ${rawResponse.$response.requestId}`);
            if (rawResponse.FunctionError) {
                if (rawResponse.LogResult) {
                    log(Buffer.from(rawResponse.LogResult!, "base64").toString());
                }
                error = new Error(rawResponse.Payload as string);
            }
            returned =
                !error &&
                rawResponse.Payload &&
                JSON.parse(rawResponse.Payload as string);
        }

        if (returned && returned.type === "error") {
            const errValue = returned.value;
            error = new Error(errValue.message);
            error.name = errValue.name;
            error.stack = errValue.stack;
        }
        const value = !error && returned && returned.value;
        let rv: Response<ReturnType<F>> = { value, error, rawResponse };
        return rv;
    };
    return responsifedFunc as any;
}

export async function deleteRole(
    RoleName: string,
    noCreateLogGroupPolicy: string | undefined,
    iam: aws.IAM
) {
    const policies = await carefully(iam.listAttachedRolePolicies({ RoleName }));
    const AttachedPolicies = (policies && policies.AttachedPolicies) || [];
    function detach(policy: aws.IAM.AttachedPolicy) {
        const PolicyArn = policy.PolicyArn!;
        return carefully(iam.detachRolePolicy({ RoleName, PolicyArn }));
    }
    await Promise.all(AttachedPolicies.map(detach)).catch(log);
    if (noCreateLogGroupPolicy) {
        await carefully(
            iam.deleteRolePolicy({ RoleName, PolicyName: noCreateLogGroupPolicy })
        );
    }
    await carefully(iam.deleteRole({ RoleName }));
}

export async function cleanup(state: State) {
    const {
        FunctionName,
        RoleName,
        logGroupName,
        rolePolicy,
        RequestTopicArn,
        ResponseQueueUrl,
        SNSLambdaSubscriptionArn
    } = state.resources;
    const { cloudwatch, iam, lambda, sqs, sns } = state.services;
    if (SNSLambdaSubscriptionArn) {
        log(`Deleting SNS subscription to lambda`);
        await quietly(sns.unsubscribe({ SubscriptionArn: SNSLambdaSubscriptionArn }));
    }
    if (RequestTopicArn) {
        log(`Deleting SNS topic: ${RequestTopicArn}`);
        await quietly(sns.deleteTopic({ TopicArn: RequestTopicArn }));
    }
    if (ResponseQueueUrl) {
        log(`Deleting SQS queue: ${ResponseQueueUrl}`);
        await quietly(sqs.deleteQueue({ QueueUrl: ResponseQueueUrl }));
    }
    if (FunctionName) {
        log(`Deleting function: ${FunctionName}`);
        await quietly(lambda.deleteFunction({ FunctionName }));
    }
    if (RoleName && rolePolicy === "createTemporaryRole") {
        log(`Deleting temporary role: ${RoleName}`);
        await deleteRole(RoleName, state.resources.noCreateLogGroupPolicy, iam);
    }
    if (logGroupName) {
        log(`Deleting log group: ${logGroupName}`);
        await quietly(cloudwatch.deleteLogGroup({ logGroupName }));
    }
    if (state.promiseQueue) {
        for (let key in Object.keys(state.promiseQueue)) {
            state.promiseQueue[key].reject(
                new Error("Call to cloud function cancelled in cleanup")
            );
        }
        state.promiseQueue = {};
    }
    state.stopResultCollector = true;
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
    return cleanup({ resources, services });
}
