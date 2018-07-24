import * as aws from "aws-sdk";
import { PromiseResult } from "aws-sdk/lib/request";
import { createHash } from "crypto";
import * as fs from "fs";
import * as uuidv4 from "uuid/v4";
import { LocalCache } from "../cache";
import { AWS, CloudFunctionImpl, CloudImpl, CreateFunctionOptions } from "../cloudify";
import { Funnel } from "../funnel";
import { log } from "../log";
import { packer, PackerOptions, PackerResult } from "../packer";
import * as cloudqueue from "../queue";
import { FunctionCall, FunctionReturn, sleep, serializeCall } from "../shared";
import * as awsNpm from "./aws-npm";
import {
    createDLQ,
    createSNSTopic,
    createSQSQueue,
    isControlMessage,
    processAWSErrorMessage,
    publishSNS,
    publishSQSControlMessage,
    receiveDLQMessages,
    receiveMessages,
    sqsMessageAttribute
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
    useDependencyCaching?: boolean;
    awsLambdaOptions?: Partial<aws.Lambda.Types.CreateFunctionRequest>;
    packerOptions?: PackerOptions;
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
    s3Bucket?: string;
    s3Key?: string;
}

export interface AWSServices {
    readonly lambda: aws.Lambda;
    readonly cloudwatch: aws.CloudWatchLogs;
    readonly iam: aws.IAM;
    readonly sqs: aws.SQS;
    readonly sns: aws.SNS;
    readonly s3: aws.S3;
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
    stop,
    getResourceList,
    setConcurrency
};

export function carefully<U>(arg: aws.Request<U, aws.AWSError>) {
    return arg.promise().catch(err => log(err));
}

export function quietly<U>(arg: aws.Request<U, aws.AWSError>) {
    return arg.promise().catch(_ => {});
}

function zipStreamToBuffer(zipStream: NodeJS.ReadableStream): Promise<Buffer> {
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
    useDependencyCaching: true,
    awsLambdaOptions: {},
    packerOptions: {}
};

export function createAWSApis(region: string): AWSServices {
    return {
        iam: new aws.IAM({ apiVersion: "2010-05-08", region }),
        lambda: new aws.Lambda({ apiVersion: "2015-03-31", region }),
        cloudwatch: new aws.CloudWatchLogs({ apiVersion: "2014-03-28", region }),
        sqs: new aws.SQS({ apiVersion: "2012-11-05", region }),
        sns: new aws.SNS({ apiVersion: "2010-03-31", region }),
        s3: new aws.S3({ apiVersion: "2006-03-01", region })
    };
}

async function createLambdaRole(
    RoleName: string,
    PolicyArn: string,
    services: AWSServices
) {
    const { iam } = services;
    log(`Checking for cached lambda role`);
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
    const noCreateLogGroupPolicy = `cloudify-deny-create-log-group-policy`;
    await addNoCreateLogPolicyToRole(RoleName, noCreateLogGroupPolicy, services);
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

export async function buildModulesOnLambda(
    s3: aws.S3,
    iam: aws.IAM,
    region: string,
    packageJson: string | object,
    indexContents: Promise<string>,
    FunctionName: string,
    useDependencyCaching: boolean
): Promise<aws.Lambda.FunctionCode> {
    log(`Building node_modules`);
    const getUserResponse = await iam.getUser().promise();
    const userId = getUserResponse.User.UserId.toLowerCase();
    const Bucket = `cloudify-cache-${region}-${userId}`;

    const packageJsonContents =
        typeof packageJson === "string"
            ? fs.readFileSync(packageJson).toString()
            : JSON.stringify(packageJson);

    const localCache = new LocalCache("aws");

    let cacheKey: string | undefined;
    if (useDependencyCaching) {
        const hasher = createHash("sha256");
        hasher.update(packageJsonContents);
        cacheKey = hasher.digest("hex");

        const localCacheEntry = await localCache.get(cacheKey);
        if (localCacheEntry) {
            log(`Using local cache entry ${localCache.dir}/${cacheKey}`);

            const stream = await awsNpm.addIndexToPackage(localCacheEntry, indexContents);
            const buf = await zipStreamToBuffer(stream);
            return { ZipFile: buf };
        }
    }

    log(`Cloudify cache bucket on S3: ${Bucket}`);
    const createdBucket = await s3
        .createBucket({
            Bucket,
            CreateBucketConfiguration: { LocationConstraint: region }
        })
        .promise()
        .catch(_ => {});

    if (createdBucket) {
        log(`Setting lifecycle expiration to 1 day for cached objects`);
        await s3
            .putBucketLifecycleConfiguration({
                Bucket,
                LifecycleConfiguration: {
                    Rules: [{ Expiration: { Days: 1 }, Status: "Enabled", Prefix: "" }]
                }
            })
            .promise();
    }

    const cloud = new AWS();
    const lambda = await cloud.createFunction(require.resolve("./aws-npm"), {
        timeout: 300,
        memorySize: 2048,
        useQueue: false
    });
    try {
        const remote = lambda.cloudifyAll(awsNpm);
        log(`package.json contents:`, packageJsonContents);
        const Key = FunctionName;

        const installArgs: awsNpm.NpmInstallArgs = {
            packageJsonContents,
            indexContents: await indexContents,
            Bucket,
            Key,
            cacheKey
        };
        const installLog = await remote.npmInstall(installArgs);
        log(installLog);

        if (cacheKey) {
            const cachedPackage = await s3.getObject({ Bucket, Key: cacheKey }).promise();
            log(`Writing local cache entry: ${localCache.dir}/${cacheKey}`);
            await localCache.set(cacheKey, cachedPackage.Body!);
        }
        return { S3Bucket: Bucket, S3Key: Key };
    } catch (err) {
        log(err);
        throw err;
    } finally {
        await lambda.cleanup();
        // await lambda.stop();
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
        awsLambdaOptions = defaults.awsLambdaOptions,
        packerOptions = defaults.packerOptions,
        useDependencyCaching = defaults.useDependencyCaching,
        ...rest
    } = options;
    log(`Creating AWS APIs`);
    const services = createAWSApis(region);
    const { lambda, sqs, s3, iam } = services;
    const FunctionName = `cloudify-${nonce}`;
    const logGroupName = `/aws/lambda/${FunctionName}`;

    if (rolePolicy === "createTemporaryRole") {
        RoleName = `cloudify-role-${nonce}`;
    }

    async function createFunction(Code: aws.Lambda.FunctionCode, Role: string) {
        const createFunctionRequest: aws.Lambda.Types.CreateFunctionRequest = {
            FunctionName,
            // Role: roleResponse.Role.Arn,
            Role,
            Runtime: "nodejs6.10",
            Handler: useQueue ? "index.snsTrampoline" : "index.trampoline",
            Code,
            Description: "cloudify trampoline function",
            Timeout,
            MemorySize,
            ...rest,
            ...awsLambdaOptions
        };
        log(`createFunctionRequest: %O`, createFunctionRequest);
        const nRetries = rolePolicy === "createTemporaryRole" ? 100 : 3;
        const func = await pollAWSRequest(nRetries, "creating function", () =>
            lambda.createFunction(createFunctionRequest)
        );
        log(`Created function ${func.FunctionName}, FunctionArn: ${func.FunctionArn}`);
        return func;
    }

    async function createCodeBundle() {
        const bundle = pack(fModule, options, packerOptions);

        let Code: aws.Lambda.FunctionCode;
        if (packerOptions.packageJson) {
            Code = await buildModulesOnLambda(
                s3,
                iam,
                region,
                packerOptions.packageJson,
                bundle.then(b => b.indexContents),
                FunctionName,
                useDependencyCaching
            );
        } else {
            Code = { ZipFile: await zipStreamToBuffer((await bundle).archive) };
        }
        return Code;
    }

    const state: State = {
        resources: {
            FunctionName,
            RoleName,
            rolePolicy,
            logGroupName,
            region
        },
        services,
        callFunnel: new Funnel()
    };

    try {
        log(`Creating log group`);
        const logGroupPromise = createLogGroup(logGroupName, services);
        log(`Creating function`);
        const createFunctionPromise = Promise.all([
            createCodeBundle(),
            createLambdaRole(RoleName, PolicyArn, services)
        ]).then(([codeBundle, roleResponse]) => {
            if (codeBundle.S3Bucket) {
                state.resources.s3Bucket = codeBundle.S3Bucket;
                state.resources.s3Key = codeBundle.S3Key;
            }
            return createFunction(codeBundle, roleResponse.Role.Arn);
        });
        const promises: Promise<any>[] = [logGroupPromise, createFunctionPromise];

        if (useQueue) {
            log(`Creating DLQ`);
            promises.push(
                createDLQ(FunctionName, sqs).then(async ({ DLQArn, DLQUrl }) => {
                    state.resources.DLQUrl = DLQUrl;
                    await createFunctionPromise;
                    log(`Adding DLQ to function`);
                    return lambda
                        .updateFunctionConfiguration({
                            FunctionName,
                            DeadLetterConfig: { TargetArn: DLQArn }
                        })
                        .promise();
                })
            );
            promises.push(
                createFunctionPromise.then(async func => {
                    if (useQueue) {
                        log(`Adding queue implementation`);
                        const awsQueueImpl = await createQueueImpl(
                            state,
                            FunctionName,
                            func.FunctionArn!
                        );
                        state.queueState = cloudqueue.initializeCloudFunctionQueue(
                            awsQueueImpl
                        );
                    }
                })
            );
        }
        await Promise.all(promises);
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
        Payload: serializeCall(callRequest)
    };
    rawResponse = await callFunnel.push(() => lambda.invoke(request).promise());
    if (rawResponse.FunctionError) {
        if (rawResponse.LogResult) {
            log(Buffer.from(rawResponse.LogResult!, "base64").toString());
        }
        const message = processAWSErrorMessage(rawResponse.Payload as string);
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
        s3Bucket,
        s3Key,
        ...rest
    } = state.resources;
    const _exhaustiveCheck: Required<typeof rest> = {};

    const { cloudwatch, iam, lambda, sqs, sns, s3 } = state.services;
    log(`Cleaning up cloudify state`);
    if (SNSLambdaSubscriptionArn) {
        log(`Deleting request queue subscription to lambda`);
        await quietly(sns.unsubscribe({ SubscriptionArn: SNSLambdaSubscriptionArn }));
    }
    const stopPromise = stop(state);
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
    if (s3Bucket && s3Key) {
        log(`Deleting S3 Bucket: ${s3Bucket}, Key: ${s3Key}`);
        await quietly(
            s3.deleteObject({
                Bucket: s3Bucket,
                Key: s3Key
            })
        );
    }
    await stopPromise;
}

export async function pack(
    functionModule: string,
    _cloudifyOptions?: Options,
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

export async function stop(state: PartialState) {
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
    packageJson,
    ...rest
}: CreateFunctionOptions<Options>): Options {
    const _exhaustiveCheck: Required<typeof rest> = {};
    const { packerOptions = {}, ...cloudSpecificOther } = cloudSpecific || {};
    return {
        timeout,
        memorySize,
        useQueue,
        packerOptions: { packageJson, ...packerOptions },
        ...cloudSpecificOther
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
    const createTopicPromise = createSNSTopic(sns, `${FunctionName}-Requests`);

    const assignRequestTopicArnPromise = createTopicPromise.then(
        topic => (resources.RequestTopicArn = topic)
    );

    const addPermissionsPromise = createTopicPromise.then(topic => {
        log(`Adding SNS invoke permissions to function`);
        return addSnsInvokePermissionsToFunction(FunctionName, topic, lambda);
    });

    const subscribePromise = createTopicPromise.then(topic => {
        log(`Subscribing SNS to invoke lambda function`);
        return sns
            .subscribe({
                TopicArn: topic,
                Protocol: "lambda",
                Endpoint: FunctionArn
            })
            .promise();
    });
    const assignSNSResponsePromise = subscribePromise.then(
        snsResponse => (resources.SNSLambdaSubscriptionArn = snsResponse.SubscriptionArn!)
    );
    log(`Creating SQS response queue`);
    const createQueuePromise = createSQSQueue(`${FunctionName}-Responses`, 60, sqs).then(
        queueUrl => (resources.ResponseQueueUrl = queueUrl)
    );
    await Promise.all([
        createTopicPromise,
        createQueuePromise,
        assignRequestTopicArnPromise,
        addPermissionsPromise,
        subscribePromise,
        assignSNSResponsePromise
    ]);
    log(`Created queue function`);
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
