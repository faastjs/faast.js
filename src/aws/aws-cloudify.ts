import * as aws from "aws-sdk";
import { NumberOfBytesType } from "aws-sdk/clients/kms";
import { PromiseResult } from "aws-sdk/lib/request";
import { createHash } from "crypto";
import * as fs from "fs";
import * as uuidv4 from "uuid/v4";
import { LocalCache } from "../cache";
import {
    AWS,
    CloudFunctionImpl,
    CloudImpl,
    CommonOptions,
    CostBreakdown,
    CostMetric,
    FunctionCounters,
    FunctionStats,
    Logger
} from "../cloudify";
import { Funnel, MemoFunnel, retry } from "../funnel";
import { log, logPricing, warn } from "../log";
import { LogStitcher } from "../logging";
import { packer, PackerOptions, PackerResult } from "../packer";
import * as cloudqueue from "../queue";
import { chomp, computeHttpResponseBytes, sleep } from "../shared";
import {
    FunctionCall,
    FunctionReturn,
    FunctionReturnWithMetrics,
    serializeCall
} from "../trampoline";
import * as awsNpm from "./aws-npm";
import {
    createSNSTopic,
    createSQSQueue,
    deadLetterMessages,
    isControlMessage,
    processAWSErrorMessage,
    publishSNS,
    publishSQSControlMessage,
    receiveMessages,
    sqsMessageAttribute
} from "./aws-queue";

export interface Options extends CommonOptions {
    region?: string;
    PolicyArn?: string;
    RoleName?: string;
    useDependencyCaching?: boolean;
    awsLambdaOptions?: Partial<aws.Lambda.Types.CreateFunctionRequest>;
}

export interface AWSLambdaPrices {
    lambdaPerRequest: number;
    lambdaPerGbSecond: number;
    snsPer64kPublish: number;
    sqsPer64kRequest: number;
    dataOutPerGb: number;
}

export class AWSMetrics {
    outboundBytes = 0;
    sns64kRequests = 0;
    sqs64kRequests = 0;
}

export interface AWSResources {
    FunctionName: string;
    RoleName: string;
    logGroupName: string;
    region: string;
    ResponseQueueUrl?: string;
    ResponseQueueArn?: string;
    RequestTopicArn?: string;
    SNSLambdaSubscriptionArn?: string;
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
    readonly pricing: aws.Pricing;
}

type AWSCloudQueueState = cloudqueue.StateWithMessageType<aws.SQS.Message>;
type AWSCloudQueueImpl = cloudqueue.QueueImpl<aws.SQS.Message>;
type AWSInvocationResponse = PromiseResult<aws.Lambda.InvocationResponse, aws.AWSError>;

export interface State {
    resources: AWSResources;
    services: AWSServices;
    callFunnel: Funnel<AWSInvocationResponse>;
    queueState?: AWSCloudQueueState;
    logStitcher: LogStitcher;
    logger?: Logger;
    options: Options;
    prices?: AWSLambdaPrices;
    metrics: AWSMetrics;
}

export const Impl: CloudImpl<Options, State> = {
    name: "aws",
    initialize,
    cleanupResources,
    pack,
    getFunctionImpl
};

export const LambdaImpl: CloudFunctionImpl<State> = {
    name: "aws",
    callFunction,
    cleanup,
    stop,
    setConcurrency,
    setLogger,
    costEstimate
};

export function carefully<U>(arg: aws.Request<U, aws.AWSError>) {
    return arg.promise().catch(err => warn(err));
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
    RoleName: "cloudify-cached-lambda-role",
    timeout: 60,
    memorySize: 256,
    useQueue: true,
    useDependencyCaching: true,
    awsLambdaOptions: {},
    addDirectory: [],
    addZipFile: [],
    packageJson: false,
    webpackOptions: {}
};

export function createAWSApis(region: string): AWSServices {
    aws.config.update({ correctClockSkew: true });
    const services = {
        iam: new aws.IAM({ apiVersion: "2010-05-08", region }),
        lambda: new aws.Lambda({ apiVersion: "2015-03-31", region }),
        cloudwatch: new aws.CloudWatchLogs({ apiVersion: "2014-03-28", region }),
        sqs: new aws.SQS({ apiVersion: "2012-11-05", region }),
        sns: new aws.SNS({ apiVersion: "2010-03-31", region }),
        s3: new aws.S3({ apiVersion: "2006-03-01", region }),
        pricing: new aws.Pricing({ region: "us-east-1" })
    };
    return services;
}

const createRoleFunnel = new MemoFunnel<string, string>(1);

async function createLambdaRole(
    RoleName: string,
    PolicyArn: string,
    services: AWSServices
) {
    const { iam } = services;
    log(`Checking for cached lambda role`);
    const previousRole = await quietly(iam.getRole({ RoleName }));
    if (previousRole) {
        return previousRole.Role.Arn;
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
    log(`Calling createRole`);
    const roleResponse = await iam.createRole(roleParams).promise();
    log(`Attaching role policy`);
    await iam.attachRolePolicy({ RoleName, PolicyArn }).promise();
    // const noCreateLogGroupPolicy = `cloudify-deny-create-log-group-policy`;
    // await addNoCreateLogPolicyToRole(RoleName, noCreateLogGroupPolicy, services);
    return roleResponse.Role.Arn;
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
    const response = await quietly(cloudwatch.createLogGroup({ logGroupName }));
    if (response) {
        log(`Adding retention policy to log group`);
        await carefully(
            cloudwatch.putRetentionPolicy({ logGroupName, retentionInDays: 1 })
        );
    } else {
        warn(`Log group could not be created, proceeding without logs.`);
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
        warn(err);
        throw err;
    }
}

async function createCacheBucket(s3: aws.S3, Bucket: string, region: string) {
    log(`Checking for cache bucket`);
    const bucket = await quietly(s3.getBucketLocation({ Bucket }));
    if (bucket) {
        return;
    }
    log(`Creating cache bucket`);
    const createdBucket = await s3
        .createBucket({
            Bucket,
            CreateBucketConfiguration: { LocationConstraint: region }
        })
        .promise();
    if (createdBucket) {
        log(`Setting lifecycle expiration to 1 day for cached objects`);
        await retry(3, () =>
            s3
                .putBucketLifecycleConfiguration({
                    Bucket,
                    LifecycleConfiguration: {
                        Rules: [
                            { Expiration: { Days: 1 }, Status: "Enabled", Prefix: "" }
                        ]
                    }
                })
                .promise()
        );
    }
}

const createBucketFunnel = new MemoFunnel<string, void>(1);

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
    await createBucketFunnel.pushMemoizedRetry(3, Bucket, () =>
        createCacheBucket(s3, Bucket, region)
    );

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
        warn(err);
        throw err;
    } finally {
        await lambda.cleanup();
        // await lambda.stop();
    }
}

export async function initialize(fModule: string, options: Options = {}): Promise<State> {
    const nonce = uuidv4();
    log(`Nonce: ${nonce}`);

    const {
        region = defaults.region,
        PolicyArn = defaults.PolicyArn,
        RoleName = defaults.RoleName,
        timeout: Timeout = defaults.timeout,
        memorySize: MemorySize = defaults.memorySize,
        useQueue = defaults.useQueue,
        awsLambdaOptions = defaults.awsLambdaOptions,
        useDependencyCaching = defaults.useDependencyCaching,
        packageJson = defaults.packageJson
    } = options;
    log(`Creating AWS APIs`);
    const services = createAWSApis(region);
    const { lambda, s3, iam } = services;
    const FunctionName = `cloudify-${nonce}`;
    const logGroupName = `/aws/lambda/${FunctionName}`;

    async function createFunction(Code: aws.Lambda.FunctionCode, Role: string) {
        const createFunctionRequest: aws.Lambda.Types.CreateFunctionRequest = {
            FunctionName,
            Role,
            // Runtime: "nodejs6.10",
            Runtime: "nodejs8.10",
            Handler: "index.trampoline",
            Code,
            Description: "cloudify trampoline function",
            Timeout,
            MemorySize,
            ...awsLambdaOptions
        };
        log(`createFunctionRequest: %O`, createFunctionRequest);
        const func = await pollAWSRequest(3, "creating function", () =>
            lambda.createFunction(createFunctionRequest)
        );
        log(`Created function ${func.FunctionName}, FunctionArn: ${func.FunctionArn}`);
        return func;
    }

    async function createCodeBundle() {
        const bundle = pack(fModule, options);

        let Code: aws.Lambda.FunctionCode;
        if (packageJson) {
            Code = await buildModulesOnLambda(
                s3,
                iam,
                region,
                packageJson,
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
            logGroupName,
            region
        },
        services,
        callFunnel: new Funnel(),
        logStitcher: new LogStitcher(),
        metrics: new AWSMetrics(),
        options
    };

    try {
        const logGroupPromise = createLogGroup(logGroupName, services);

        log(`Creating function`);
        const rolePromise = createRoleFunnel.pushMemoizedRetry(3, RoleName, () =>
            createLambdaRole(RoleName, PolicyArn, services)
        );

        const createFunctionPromise = Promise.all([createCodeBundle(), rolePromise]).then(
            ([codeBundle, roleArn]) => {
                if (codeBundle.S3Bucket) {
                    state.resources.s3Bucket = codeBundle.S3Bucket;
                    state.resources.s3Key = codeBundle.S3Key;
                }
                return createFunction(codeBundle, roleArn);
            }
        );

        const pricingPromise = awsPrices(services.pricing, region).then(prices => {
            state.prices = prices;
            logPricing("AWS prices: %O", prices);
        });

        const promises: Promise<any>[] = [
            logGroupPromise,
            createFunctionPromise,
            pricingPromise
        ];

        if (useQueue) {
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
                        log(`Adding DLQ to function`);
                        lambda
                            .updateFunctionConfiguration({
                                FunctionName,
                                DeadLetterConfig: {
                                    TargetArn: state.resources.ResponseQueueArn
                                }
                            })
                            .promise();
                    }
                })
            );
        }
        await Promise.all(promises);
        log(`Lambda function initialization complete.`);
        return state;
    } catch (err) {
        warn(`ERROR: ${err}`);
        await cleanup(state);
        throw err;
    }
}

async function callFunctionHttps(
    lambda: aws.Lambda,
    FunctionName: string,
    callRequest: FunctionCall,
    callFunnel: Funnel<AWSInvocationResponse>,
    metrics: AWSMetrics
): Promise<FunctionReturnWithMetrics> {
    let returned: FunctionReturn;
    let rawResponse: AWSInvocationResponse;

    const request: aws.Lambda.Types.InvocationRequest = {
        FunctionName,
        Payload: serializeCall(callRequest),
        LogType: "None"
    };
    let localRequestSentTime!: NumberOfBytesType;
    rawResponse = await callFunnel.push(() => {
        const awsRequest = lambda.invoke(request);
        localRequestSentTime = awsRequest.startTime.getTime();
        return awsRequest.promise();
    });
    const localEndTime = Date.now();

    if (rawResponse.LogResult) {
        log(Buffer.from(rawResponse.LogResult!, "base64").toString());
    }
    if (rawResponse.FunctionError) {
        const message = processAWSErrorMessage(rawResponse.Payload as string);
        returned = {
            type: "error",
            CallId: callRequest.CallId,
            value: new Error(message)
        };
    } else {
        const payload = rawResponse.Payload! as string;
        returned = JSON.parse(payload);
    }
    metrics.outboundBytes += computeHttpResponseBytes(
        rawResponse.$response.httpResponse.headers
    );
    return {
        returned,
        localRequestSentTime,
        remoteResponseSentTime: returned.remoteExecutionEndTime!,
        localEndTime,
        rawResponse
    };
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
            resources: { FunctionName },
            metrics
        } = state;
        return callFunctionHttps(lambda, FunctionName, callRequest, callFunnel, metrics);
    }
}

export async function deleteRole(RoleName: string, iam: aws.IAM) {
    const policies = await carefully(iam.listAttachedRolePolicies({ RoleName }));
    const AttachedPolicies = (policies && policies.AttachedPolicies) || [];
    await Promise.all(
        AttachedPolicies.map(p => p.PolicyArn!).map(PolicyArn =>
            carefully(iam.detachRolePolicy({ RoleName, PolicyArn }))
        )
    ).catch(warn);
    const rolePolicyListResponse = await carefully(iam.listRolePolicies({ RoleName }));
    const RolePolicies =
        (rolePolicyListResponse && rolePolicyListResponse.PolicyNames) || [];
    await Promise.all(
        RolePolicies.map(PolicyName =>
            carefully(iam.deleteRolePolicy({ RoleName, PolicyName }))
        )
    ).catch(warn);
    await carefully(iam.deleteRole({ RoleName }));
}

export type PartialState = Partial<State> & Pick<State, "services" | "resources">;

export async function cleanup(state: PartialState) {
    const {
        FunctionName,
        RoleName,
        logGroupName,
        region,
        RequestTopicArn,
        ResponseQueueUrl,
        ResponseQueueArn,
        SNSLambdaSubscriptionArn,
        s3Bucket,
        s3Key,
        ...rest
    } = state.resources;
    const _exhaustiveCheck: Required<typeof rest> = {};

    const { cloudwatch, lambda, sqs, sns, s3 } = state.services;
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
    if (RoleName) {
        // Don't delete cached role. It may be in use by other instances of cloudify.
        // await deleteRole(RoleName, iam);
    }
    if (RequestTopicArn) {
        log(`Deleting request queue topic: ${RequestTopicArn}`);
        await quietly(sns.deleteTopic({ TopicArn: RequestTopicArn }));
    }
    if (ResponseQueueUrl) {
        log(`Deleting response queue: ${ResponseQueueUrl}`);
        await quietly(sqs.deleteQueue({ QueueUrl: ResponseQueueUrl }));
    }
    if (s3Bucket && s3Key) {
        log(`Deleting S3 Key: ${s3Key} in Bucket: ${s3Bucket}`);
        await quietly(
            s3.deleteObject({
                Bucket: s3Bucket,
                Key: s3Key
            })
        );
    }
    log(`Awaiting stop promise`);
    await stopPromise;
    log(`Cleanup done`);
}

export async function pack(
    functionModule: string,
    options?: Options
): Promise<PackerResult> {
    const { webpackOptions, ...rest }: PackerOptions = options || {};
    return packer(
        {
            trampolineModule: require.resolve("./aws-trampoline"),
            functionModule
        },
        {
            webpackOptions: { externals: "aws-sdk", ...webpackOptions },
            ...rest
        }
    );
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
    state.logger = undefined;
    callFunnel &&
        callFunnel
            .pendingFutures()
            .forEach(p => p.reject(new Error("Rejected pending request")));
    if (state.queueState) {
        await cloudqueue.stop(state.queueState);
    }
    return JSON.stringify(state.resources);
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

export function getFunctionImpl() {
    return LambdaImpl;
}

export async function createQueueImpl(
    state: State,
    FunctionName: string,
    FunctionArn: string
): Promise<AWSCloudQueueImpl> {
    const { sqs, sns, lambda } = state.services;
    const { resources, metrics } = state;
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
        ({ QueueUrl, QueueArn }) => {
            resources.ResponseQueueUrl = QueueUrl;
            resources.ResponseQueueArn = QueueArn;
        }
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
            receiveMessages(sqs, resources.ResponseQueueUrl!, metrics),
        getMessageBody: message => message.Body || "",
        getMessageSentTimestamp: message => Number(message.Attributes!.SentTimestamp),
        description: () => resources.ResponseQueueUrl!,
        publishRequestMessage: call =>
            publishSNS(sns, resources.RequestTopicArn!, call, metrics),
        publishReceiveQueueControlMessage: type =>
            publishSQSControlMessage(type, sqs, resources.ResponseQueueUrl!),
        isControlMessage: (message, type) => isControlMessage(message, type),
        deadLetterMessages: message => deadLetterMessages(message)
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

async function* readLogsRaw(
    logGroupName: string,
    cloudwatch: AWS.CloudWatchLogs,
    logStitcher: LogStitcher,
    metrics: AWSMetrics
) {
    let nextToken: string | undefined;
    do {
        const result = await cloudwatch
            .filterLogEvents({
                logGroupName,
                nextToken,
                startTime: logStitcher.lastLogEventTime
            })
            .promise();
        metrics.outboundBytes += computeHttpResponseBytes(
            result.$response.httpResponse.headers
        );
        nextToken = result.nextToken;
        const { events } = result;
        if (events) {
            const newEvents = events.filter(e => !logStitcher.has(e.eventId!));
            if (newEvents.length > 0) {
                yield newEvents;
            }
            logStitcher.updateEvents(events, e => e.timestamp, e => e.eventId);
        }
    } while (nextToken);
}

async function outputCurrentLogs(state: State) {
    const logStream = readLogsRaw(
        state.resources.logGroupName,
        state.services.cloudwatch,
        state.logStitcher,
        state.metrics
    );
    for await (const entries of logStream) {
        const newEntries = entries.filter(entry => entry.message);
        for (const entry of newEntries) {
            if (!state.logger) {
                return;
            }
            state.logger(
                `${new Date(entry.timestamp!).toLocaleString()} ${chomp(entry.message!)}`
            );
        }
    }
}

async function outputLogs(state: State) {
    while (state.logger) {
        const start = Date.now();
        await outputCurrentLogs(state).catch(_ => {});
        if (!state.logger) {
            break;
        }
        const delay = 1000 - (Date.now() - start);
        if (delay > 0) {
            await sleep(delay);
        }
    }
}

function setLogger(state: State, logger: Logger | undefined) {
    const prev = state.logger;
    state.logger = logger;
    if (!prev) {
        outputLogs(state);
    }
}

// https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-regions-availability-zones.html
const locations = {
    "us-east-1": "US East (N. Virginia)",
    "us-east-2": "US East (Ohio)",
    "us-west-1": "US West (N. California)",
    "us-west-2": "US West (Oregon)",
    "ca-central-1": "Canada (Central)",
    "eu-central-1": "EU (Frankfurt)",
    "eu-west-1": "EU (Ireland)",
    "eu-west-2": "EU (London)",
    "eu-west-3": "EU (Paris)",
    "ap-northeast-1": "Asia Pacific (Tokyo)",
    "ap-northeast-2": "Asia Pacific (Seoul)",
    "ap-northeast-3": "Asia Pacific (Osaka-Local)",
    "ap-southeast-1": "Asia Pacific (Singapore)",
    "ap-southeast-2": "Asia Pacific (Sydney)",
    "ap-south-1": "Asia Pacific (Mumbai)",
    "sa-east-1": "South America (São Paulo)"
};

export async function awsPrice(
    pricing: aws.Pricing,
    ServiceCode: string,
    filter: object
) {
    try {
        function first(obj: object) {
            return obj[Object.keys(obj)[0]];
        }
        function extractPrice(obj: any) {
            const prices = Object.keys(obj.priceDimensions).map(key =>
                Number(obj.priceDimensions[key].pricePerUnit.USD)
            );
            return Math.max(...prices);
        }
        const priceResult = await pricing
            .getProducts({
                ServiceCode,
                Filters: Object.keys(filter).map(key => ({
                    Field: key,
                    Type: "TERM_MATCH",
                    Value: filter[key]
                }))
            })
            .promise();
        if (priceResult.PriceList!.length > 1) {
            warn(
                `Price query returned more than one product '${ServiceCode}' ($O)`,
                filter
            );
        }
        const pList: any = priceResult.PriceList![0];
        const price = extractPrice(first(pList.terms.OnDemand));
        return price;
    } catch (err) {
        warn(`Could not get AWS pricing for '${ServiceCode}' (%O)`, filter);
        warn(err);
        return 0;
    }
}

export async function awsPrices(
    pricing: aws.Pricing,
    region: string
): Promise<AWSLambdaPrices> {
    const location = locations[region];
    return {
        lambdaPerRequest: await awsPrice(pricing, "AWSLambda", {
            location,
            group: "AWS-Lambda-Requests"
        }),
        lambdaPerGbSecond: await awsPrice(pricing, "AWSLambda", {
            location,
            group: "AWS-Lambda-Duration"
        }),
        snsPer64kPublish: await awsPrice(pricing, "AmazonSNS", {
            location,
            group: "SNS-Requests-Tier1"
        }),
        sqsPer64kRequest: await awsPrice(pricing, "AWSQueueService", {
            location,
            group: "SQS-APIRequest-Tier1",
            queueType: "Standard"
        }),
        dataOutPerGb: await awsPrice(pricing, "AWSDataTransfer", {
            fromLocation: location,
            transferType: "AWS Outbound"
        })
    };
}

export function costEstimate(
    state: State,
    counters: FunctionCounters,
    statistics: FunctionStats
): Promise<CostBreakdown> {
    const prices = state.prices!;

    const { memorySize = defaults.memorySize } = state.options;
    const billedTimeStats = statistics.estimatedBilledTimeMs;
    const seconds = (billedTimeStats.mean / 1000) * billedTimeStats.samples;
    const provisionedGb = memorySize / 1024;
    const functionCallDuration = new CostMetric({
        pricing: prices.lambdaPerGbSecond * provisionedGb,
        unit: "second",
        measured: seconds,
        comment: ` // ${provisionedGb} GB`
    });

    const functionCallRequests = new CostMetric({
        pricing: prices.lambdaPerRequest,
        measured: counters.completed + counters.retries + counters.errors,
        unit: "request"
    });

    const { metrics } = state;
    const outboundDataTransfer = new CostMetric({
        pricing: prices.dataOutPerGb,
        measured: metrics.outboundBytes / 2 ** 30,
        unit: "GB"
    });

    const sqs: CostMetric = new CostMetric({
        pricing: prices.sqsPer64kRequest,
        measured: metrics.sqs64kRequests,
        unit: "request"
    });

    const sns: CostMetric = new CostMetric({
        pricing: prices.snsPer64kPublish,
        measured: metrics.sns64kRequests,
        unit: "request"
    });

    return Promise.resolve(
        new CostBreakdown({
            functionCallDuration,
            functionCallRequests,
            outboundDataTransfer,
            sns,
            sqs
        })
    );
}
