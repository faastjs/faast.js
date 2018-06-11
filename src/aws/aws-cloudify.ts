import * as aws from "aws-sdk";
import debug from "debug";
import humanStringify from "human-stringify";
import { Readable } from "stream";
import * as uuidv4 from "uuid/v4";
import { AnyFunction, Response, ResponsifiedFunction } from "../cloudify";
import { log } from "../log";
import { packer, PackerResult } from "../packer";
import { FunctionCall, FunctionReturn } from "../shared";

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
    callResultPromises: Map<string, Deferred<QueuedResponse<any>>>;
    resultCollectorPromise?: Promise<void>;
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

function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export let defaults: Required<Options> = {
    region: "us-west-1",
    PolicyArn: "arn:aws:iam::aws:policy/AdministratorAccess",
    rolePolicy: "createOrReuseCachedRole",
    RoleName: "cloudify-cached-role",
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
    const response = await cloudwatch.createLogGroup({ logGroupName }).promise();
    await cloudwatch.putRetentionPolicy({ logGroupName, retentionInDays: 1 }).promise();
}

function addSnsInvokePermissionsToFunction(
    FunctionName: string,
    RequestTopicArn: string,
    services: AWSServices
) {
    const { lambda } = services;
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

    if (rolePolicy === "createTemporaryRole") {
        RoleName = `cloudify-role-${nonce}`;
    }

    async function createFunction() {
        let roleResponse =
            (await quietly(iam.getRole({ RoleName }))) ||
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
            Handler: useQueue ? "index.snsTrampoline" : "index.trampoline",
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
        callResultPromises: new Map(),
        resources: {
            FunctionName,
            RoleName,
            rolePolicy,
            logGroupName,
            region
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
            const addPermissionResponse = await addSnsInvokePermissionsToFunction(
                FunctionName,
                RequestTopicArn,
                services
            );
            log(
                `Added SNS invoke permission to function. Statement ID: ${
                    addPermissionResponse.Statement
                }`
            );
            const snsRepsonse = await sns
                .subscribe({
                    TopicArn: RequestTopicArn,
                    Protocol: "lambda",
                    Endpoint: FunctionArn
                })
                .promise();
            log(`Created SNS subscription: ${snsRepsonse.SubscriptionArn}`);
            state.resources.SNSLambdaSubscriptionArn = snsRepsonse.SubscriptionArn!;
            startResultCollectorIfNeeded(state);
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

function createDeferred<T>(): Deferred<T> {
    let resolver!: (arg?: any) => void;
    let rejector!: (err?: any) => void;
    const promise = new Promise<any>((resolve, reject) => {
        resolver = resolve;
        rejector = reject;
    });
    return {
        resolve: resolver,
        reject: rejector,
        promise
    };
}

interface CallResults {
    CallId?: string;
    message: aws.SQS.Message;
    deferred?: Deferred<QueuedResponse<any>>;
}

async function resultCollector(state: State) {
    const { sqs } = state.services;
    const { ResponseQueueUrl } = state.resources;
    const log = debug("cloudify:collector");
    const { callResultPromises } = state;

    function deleteMessages(Messages: aws.SQS.Message[]) {
        if (Messages.length > 0) {
            carefully(
                sqs.deleteMessageBatch({
                    QueueUrl: ResponseQueueUrl!,
                    Entries: Messages.map(m => ({
                        Id: m.MessageId!,
                        ReceiptHandle: m.ReceiptHandle!
                    }))
                })
            );
        }
    }

    function resolvePromises(results: CallResults[]) {
        for (const { message, CallId, deferred } of results) {
            if (!CallId) {
                const { MessageId, MessageAttributes, Body } = message;
                log(
                    `No CallId for MessageId: ${MessageId}, attributes: ${MessageAttributes}, Body: ${Body}`
                );
            }
            if (!message.Body) continue;
            const returned: FunctionReturn = JSON.parse(message.Body);
            if (!deferred) {
                log(`Deferred promise not found for CallID: ${CallId}`);
            } else {
                deferred.resolve({ returned, rawResponse: message });
            }
        }
    }

    while (callResultPromises.size > 0) {
        log(
            `Polling response queue (size ${
                callResultPromises.size
            }): ${ResponseQueueUrl}`
        );

        const response = await sqs
            .receiveMessage({
                QueueUrl: ResponseQueueUrl!,
                WaitTimeSeconds: 20,
                MaxNumberOfMessages: 10,
                MessageAttributeNames: ["All"]
            })
            .promise();

        const { Messages = [] } = response;
        log(`received ${Messages.length} messages.`);

        deleteMessages(Messages);

        try {
            const callResults = Messages.map(m => {
                const CallId = m.MessageAttributes!.CallId.StringValue!;
                return {
                    CallId,
                    message: m,
                    deferred: callResultPromises.get(CallId)
                };
            });
            callResults.forEach(({ CallId }) => callResultPromises.delete(CallId));
            setTimeout(() => resolvePromises(callResults), 0);
        } catch (err) {
            log(err);
        }
    }
    delete state.resultCollectorPromise;
    setTimeout(() => {
        startResultCollectorIfNeeded(state);
    }, 0);
}

function startResultCollectorIfNeeded(state: State) {
    if (state.callResultPromises.size > 0 && !state.resultCollectorPromise) {
        state.resultCollectorPromise = resultCollector(state);
    }
}

function enqueueCallRequest(state: State, CallId: string): Deferred<any> {
    const deferred = createDeferred<QueuedResponse<any>>();
    log(`Enqueuing call request CallId: ${CallId}, deferred: ${deferred}`);
    state.callResultPromises.set(CallId, deferred);
    startResultCollectorIfNeeded(state);
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
        const { lambda } = state.services;
        let returned: FunctionReturn | undefined;
        let error: Error | undefined;
        let rawResponse: any;
        if (state.useQueue) {
            const { sns } = state.services;
            const responsePromise = enqueueCallRequest(state, CallId).promise;
            const snsResponse = await sns
                .publish({ TopicArn: RequestTopicArn, Message: callArgsStr })
                .promise();
            log(`SNS Message ID: ${snsResponse.MessageId}`);
            ({ returned, rawResponse } = await responsePromise);
        } else {
            const request: aws.Lambda.Types.InvocationRequest = {
                FunctionName: FunctionName,
                LogType: "Tail",
                Payload: callArgsStr
            };
            log(`Invocation request: ${humanStringify(request)}`);
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

type PartialState = Exclude<State, "resources"> & {
    resources: Partial<AWSResources>;
};

export async function cleanup(state: PartialState) {
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
    log(`Cleaning up cloudify state`);
    if (SNSLambdaSubscriptionArn) {
        log(`Deleting Request queue subscription to lambda`);
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
    let requestPromise, responsePromise;
    if (RequestTopicArn) {
        log(`Deleting Request queue topic: ${RequestTopicArn}`);
        requestPromise = quietly(sns.deleteTopic({ TopicArn: RequestTopicArn }));
    }
    if (ResponseQueueUrl) {
        log(`Deleting Response queue: ${ResponseQueueUrl}`);
        responsePromise = quietly(sqs.deleteQueue({ QueueUrl: ResponseQueueUrl }));
    }
    await Promise.all([requestPromise, responsePromise]);
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
    return cleanup({ resources, services, callResultPromises: new Map() });
}

export async function cancelWithoutCleanup(state: State) {
    log(`Clearing result promises`);
    const callResultPromises = state.callResultPromises;
    for (const [key, promise] of callResultPromises) {
        log(`Rejecting call result: ${key}`);
        promise.reject(new Error("Call to cloud function cancelled in cleanup"));
    }
    state.callResultPromises.clear();
    if (state.resultCollectorPromise) {
        log(`Waiting for result collector to stop (this can take up to 20s)`);
        await state.resultCollectorPromise;
    }
}
