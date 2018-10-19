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
    FunctionCounters,
    FunctionStats
} from "../cloudify";
import { CostBreakdown, CostMetric } from "../cost-analyzer";
import { Funnel, MemoFunnel, RateLimitedFunnel, retry } from "../funnel";
import { log, logGc, warn } from "../log";
import { packer, PackerOptions, PackerResult } from "../packer";
import * as cloudqueue from "../queue";
import { computeHttpResponseBytes, hasExpired, sleep } from "../shared";
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

export interface AWSPrices {
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
    region: string;
    ResponseQueueUrl?: string;
    ResponseQueueArn?: string;
    RequestTopicArn?: string;
    SNSLambdaSubscriptionArn?: string;
    s3Bucket?: string;
    s3Key?: string;
    logGroupName: string;
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
    options: Options;
    metrics: AWSMetrics;
    gcPromise?: Promise<void>;
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
    costEstimate,
    logUrl
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
    concurrency: 500,
    mode: "https",
    gc: true,
    retentionInDays: 1,
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
    return roleResponse.Role.Arn;
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

const createBucketFunnel = new MemoFunnel<string>(1);

async function getBucketName(region: string, iam: aws.IAM) {
    const getUserResponse = await iam.getUser().promise();
    const userId = getUserResponse.User.UserId.toLowerCase();
    return `cloudify-cache-${region}-${userId}`;
}

function getS3Key(FunctionName: string) {
    return FunctionName;
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
    const Bucket = await getBucketName(region, iam);

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
        mode: "https"
    });
    try {
        const remote = lambda.cloudifyModule(awsNpm);
        log(`package.json contents:`, packageJsonContents);
        const Key = getS3Key(FunctionName);

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

const priceRequestFunnel = new MemoFunnel<string, AWSPrices>(1);

export function getLogGroupName(FunctionName: string) {
    return `/aws/lambda/${FunctionName}`;
}

export function logUrl(state: State) {
    const { region, FunctionName } = state.resources;
    const logGroupName = getLogGroupName(FunctionName);
    return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logStream:group=${logGroupName}`;
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
        concurrency = defaults.concurrency,
        mode = defaults.mode,
        gc = defaults.gc,
        retentionInDays = defaults.retentionInDays,
        awsLambdaOptions = defaults.awsLambdaOptions,
        useDependencyCaching = defaults.useDependencyCaching,
        packageJson = defaults.packageJson
    } = options;
    log(`Creating AWS APIs`);
    const services = createAWSApis(region);
    const { lambda, s3, iam } = services;
    const FunctionName = `cloudify-${nonce}`;

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
            region,
            logGroupName: getLogGroupName(FunctionName)
        },
        services,
        callFunnel: new Funnel(concurrency),
        metrics: new AWSMetrics(),
        options
    };

    if (gc) {
        logGc(`Starting garbage collector`);
        state.gcPromise = collectGarbage(services, region, retentionInDays);
    }

    try {
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

        const pricingPromise = priceRequestFunnel.pushMemoized(region, () =>
            requestAwsPrices(services.pricing, region)
        );

        const promises: Promise<any>[] = [createFunctionPromise, pricingPromise];

        if (mode === "queue") {
            promises.push(
                createFunctionPromise.then(async func => {
                    log(`Adding queue implementation`);
                    const awsQueueImpl = await createQueueImpl(
                        state,
                        FunctionName,
                        func.FunctionArn!
                    );
                    state.queueState = cloudqueue.initializeCloudFunctionQueue(
                        awsQueueImpl
                    );
                    retry(3, () => {
                        log(`Adding DLQ to function`);
                        return lambda
                            .updateFunctionConfiguration({
                                FunctionName,
                                DeadLetterConfig: {
                                    TargetArn: state.resources.ResponseQueueArn
                                }
                            })
                            .promise();
                    }).catch(err => {
                        warn(err);
                        warn(`Could not add DLQ to function, continuing without it.`);
                    });
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
    metrics: AWSMetrics,
    callFunnel: Funnel<AWSInvocationResponse>,
    shouldRetry: (err: Error, retries: number) => boolean
): Promise<FunctionReturnWithMetrics> {
    let returned: FunctionReturn;
    let rawResponse: AWSInvocationResponse;

    const request: aws.Lambda.Types.InvocationRequest = {
        FunctionName,
        Payload: serializeCall(callRequest),
        LogType: "None"
    };
    let localRequestSentTime!: NumberOfBytesType;
    rawResponse = await callFunnel.pushRetry(shouldRetry, () => {
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

async function callFunction(
    state: State,
    callRequest: FunctionCall,
    shouldRetry: (err: Error, n: number) => boolean
) {
    if (state.queueState) {
        return cloudqueue.enqueueCallRequest(
            state.queueState,
            callRequest,
            state.resources.ResponseQueueUrl!
        );
    } else {
        const { callFunnel, metrics } = state;
        const { lambda } = state.services;
        const { FunctionName } = state.resources;

        return callFunctionHttps(
            lambda,
            FunctionName,
            callRequest,
            metrics,
            callFunnel,
            shouldRetry
        );
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

async function deleteResources(
    resources: AWSResources,
    services: AWSServices,
    output: (msg: string) => void = log
) {
    const {
        FunctionName,
        RoleName,
        region,
        RequestTopicArn,
        ResponseQueueUrl,
        ResponseQueueArn,
        SNSLambdaSubscriptionArn,
        s3Bucket,
        s3Key,
        logGroupName,
        ...rest
    } = resources;
    const _exhaustiveCheck: Required<typeof rest> = {};

    const { lambda, sqs, sns, s3 } = services;
    if (SNSLambdaSubscriptionArn) {
        if (
            await quietly(sns.unsubscribe({ SubscriptionArn: SNSLambdaSubscriptionArn }))
        ) {
            output(`Deleted request queue subscription to lambda`);
        }
    }
    if (RoleName) {
        // Don't delete cached role. It may be in use by other instances of cloudify.
        // await deleteRole(RoleName, iam);
    }
    if (RequestTopicArn) {
        if (await quietly(sns.deleteTopic({ TopicArn: RequestTopicArn }))) {
            output(`Deleted request queue topic: ${RequestTopicArn}`);
        }
    }
    if (ResponseQueueUrl) {
        if (await quietly(sqs.deleteQueue({ QueueUrl: ResponseQueueUrl }))) {
            output(`Deleted response queue: ${ResponseQueueUrl}`);
        }
    }
    if (s3Bucket && s3Key) {
        const deleteKey = quietly(s3.deleteObject({ Bucket: s3Bucket, Key: s3Key }));
        if (await deleteKey) {
            output(`Deleted S3 Key: ${s3Key} in Bucket: ${s3Bucket}`);
        }
    }
    if (FunctionName) {
        if (await quietly(lambda.deleteFunction({ FunctionName }))) {
            output(`Deleted function: ${FunctionName}`);
        }
    }
    if (logGroupName) {
        // Don't delete logs. They are often useful. By default retention will
        // be 1 day, and gc will clean it out.
    }
}

async function addLogRetentionPolicy(
    FunctionName: string,
    cloudwatch: aws.CloudWatchLogs
) {
    const logGroupName = getLogGroupName(FunctionName);
    const response = quietly(
        cloudwatch.putRetentionPolicy({ logGroupName, retentionInDays: 1 })
    );
    if (response !== undefined) {
        log(`Added 1 day retention policy to log group ${logGroupName}`);
    }
}

export async function cleanup(state: PartialState) {
    await stop(state);
    log(`Cleaning up cloudify infrastructure for ${state.resources.FunctionName}...`);
    await deleteResources(state.resources, state.services);
    log(`Cleanup done.`);
}

let garbageCollectorRunning = false;

function functionNameFromLogGroup(logGroupName: string) {
    const match = logGroupName.match(/\/aws\/lambda\/(cloudify-[a-f0-9-]+)/);
    return match && match[1];
}

export async function collectGarbage(
    services: AWSServices,
    region: string,
    retentionInDays: number
) {
    if (garbageCollectorRunning) {
        return;
    }
    garbageCollectorRunning = true;
    try {
        const accountId = await getAccountId(services.iam);
        const s3Bucket = await getBucketName(region, services.iam);
        const gcFunnel = new RateLimitedFunnel({
            maxConcurrency: 5,
            targetRequestsPerSecond: 5,
            maxBurst: 2
        });
        const functionsWithLogGroups = new Set();

        await new Promise((resolve, reject) =>
            services.cloudwatch
                .describeLogGroups({ logGroupNamePrefix: "/aws/lambda/cloudify-" })
                .eachPage((err, page) => {
                    if (err) {
                        warn(`GC: Error when describing log groups: ${err}`);
                        reject(err);
                        return false;
                    }
                    if (page === null) {
                        resolve();
                    } else if (page.logGroups) {
                        page.logGroups.forEach(g =>
                            functionsWithLogGroups.add(
                                functionNameFromLogGroup(g.logGroupName!)
                            )
                        );
                        garbageCollectLogGroups(
                            services,
                            page.logGroups!,
                            retentionInDays,
                            region,
                            accountId,
                            s3Bucket,
                            gcFunnel
                        );
                    }
                    return true;
                })
        );
        await new Promise((resolve, reject) =>
            services.lambda.listFunctions().eachPage((err, page) => {
                if (err) {
                    warn(`GC: Error listing lambda functions: ${err}`);
                    reject(err);
                    return false;
                }
                if (page === null) {
                    resolve();
                } else {
                    const funcs = (page.Functions || [])
                        .filter(fn => fn.FunctionName!.match(/^cloudify-/))
                        .filter(fn => !functionsWithLogGroups.has(fn.FunctionName))
                        .filter(fn => hasExpired(fn.LastModified, retentionInDays))
                        .map(fn => fn.FunctionName!);

                    deleteGarbageFunctions(
                        services,
                        region,
                        accountId,
                        s3Bucket,
                        funcs,
                        gcFunnel
                    );
                }
                return true;
            })
        );

        await gcFunnel.all();
    } finally {
        garbageCollectorRunning = false;
    }
}

async function getAccountId(iam: aws.IAM) {
    const user = await iam.getUser().promise();
    const arn = user.User.Arn;
    return arn.split(":")[4];
}

function garbageCollectLogGroups(
    services: AWSServices,
    logGroups: aws.CloudWatchLogs.LogGroup[],
    retentionInDays: number,
    region: string,
    accountId: string,
    s3Bucket: string,
    garbageCollectionFunnel: Funnel
) {
    const { cloudwatch } = services;

    const logGroupsMissingRetentionPolicy = logGroups.filter(
        g => g.retentionInDays === undefined
    );

    logGroupsMissingRetentionPolicy.forEach(g =>
        garbageCollectionFunnel.push(async () => {
            if (
                await quietly(
                    cloudwatch.putRetentionPolicy({
                        logGroupName: g.logGroupName!,
                        retentionInDays
                    })
                )
            ) {
                logGc(
                    `Added retention policy of ${retentionInDays} day(s) to ${
                        g.logGroupName
                    }`
                );
            }
        })
    );

    const garbageFunctions = logGroups
        .filter(g => hasExpired(g.creationTime, retentionInDays))
        .filter(g => g.storedBytes! === 0)
        .map(g => functionNameFromLogGroup(g.logGroupName!)!)
        .filter(n => n);

    deleteGarbageFunctions(
        services,
        region,
        accountId,
        s3Bucket,
        garbageFunctions,
        garbageCollectionFunnel
    );
}

function deleteGarbageFunctions(
    services: AWSServices,
    region: string,
    accountId: string,
    s3Bucket: string,
    garbageFunctions: string[],
    garbageCollectionFunnel: Funnel
) {
    garbageFunctions.forEach(FunctionName => {
        const resources: AWSResources = {
            FunctionName,
            region,
            RoleName: "",
            RequestTopicArn: getSNSTopicArn(region, accountId, FunctionName),
            ResponseQueueUrl: getResponseQueueUrl(region, accountId, FunctionName),
            s3Bucket,
            s3Key: getS3Key(FunctionName),
            logGroupName: getLogGroupName(FunctionName)
        };
        garbageCollectionFunnel.push(async () => {
            await deleteResources(resources, services, logGc);
            const logGroupName = getLogGroupName(FunctionName);
            if (await quietly(services.cloudwatch.deleteLogGroup({ logGroupName }))) {
                logGc(`Deleted log group ${logGroupName}`);
            }
        });
    });
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
    callFunnel && callFunnel.clear();
    if (state.queueState) {
        await cloudqueue.stop(state.queueState);
    }
    await addLogRetentionPolicy(state.resources.FunctionName, state.services.cloudwatch);
    if (state.gcPromise) {
        log(`Waiting for garbage collection...`);
        await state.gcPromise;
        log(`Garbage collection done.`);
    }
    return JSON.stringify(state.resources);
}

export async function setConcurrency(state: State, maxConcurrentExecutions: number) {
    state.callFunnel.setMaxConcurrency(maxConcurrentExecutions);
}

export function getFunctionImpl() {
    return LambdaImpl;
}

function getSNSTopicName(FunctionName: string) {
    return `${FunctionName}-Requests`;
}

function getSNSTopicArn(region: string, accountId: string, FunctionName: string) {
    const TopicName = getSNSTopicName(FunctionName);
    return `arn:aws:sns:${region}:${accountId}:${TopicName}`;
}

function getSQSName(FunctionName: string) {
    return `${FunctionName}-Responses`;
}

function getResponseQueueUrl(region: string, accountId: string, FunctionName: string) {
    const queueName = getSQSName(FunctionName);
    return `https://sqs.${region}.amazonaws.com/${accountId}/${queueName}`;
}

export async function createQueueImpl(
    state: State,
    FunctionName: string,
    FunctionArn: string
): Promise<AWSCloudQueueImpl> {
    const { sqs, sns, lambda } = state.services;
    const { resources, metrics } = state;
    log(`Creating SNS request topic`);
    const createTopicPromise = createSNSTopic(sns, getSNSTopicName(FunctionName));

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
    const createQueuePromise = createSQSQueue(getSQSName(FunctionName), 60, sqs).then(
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
    return retry(3, () =>
        lambda
            .addPermission({
                FunctionName,
                Action: "lambda:InvokeFunction",
                Principal: "sns.amazonaws.com",
                StatementId: `${FunctionName}-Invoke`,
                SourceArn: RequestTopicArn
            })
            .promise()
    );
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

export async function requestAwsPrices(
    pricing: aws.Pricing,
    region: string
): Promise<AWSPrices> {
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

export async function costEstimate(
    state: State,
    counters: FunctionCounters,
    statistics: FunctionStats
): Promise<CostBreakdown> {
    const costs = new CostBreakdown();
    const { region } = state.resources;
    const prices = await priceRequestFunnel.pushMemoized(region, () =>
        requestAwsPrices(state.services.pricing, region)
    );
    const { memorySize = defaults.memorySize } = state.options;
    const billedTimeStats = statistics.estimatedBilledTime;
    const seconds = (billedTimeStats.mean / 1000) * billedTimeStats.samples;
    const provisionedGb = memorySize / 1024;
    const functionCallDuration = new CostMetric({
        name: "functionCallDuration",
        pricing: prices.lambdaPerGbSecond * provisionedGb,
        unit: "second",
        measured: seconds,
        comment: `https://aws.amazon.com/lambda/pricing (rate = ${prices.lambdaPerGbSecond.toFixed(
            8
        )}/(GB*second) * ${provisionedGb} GB = ${(
            prices.lambdaPerGbSecond * provisionedGb
        ).toFixed(8)}/second)`
    });
    costs.push(functionCallDuration);

    const functionCallRequests = new CostMetric({
        name: "functionCallRequests",
        pricing: prices.lambdaPerRequest,
        measured: counters.completed + counters.retries + counters.errors,
        unit: "request",
        comment: "https://aws.amazon.com/lambda/pricing"
    });
    costs.push(functionCallRequests);

    const { metrics } = state;
    const outboundDataTransfer = new CostMetric({
        name: "outboundDataTransfer",
        pricing: prices.dataOutPerGb,
        measured: metrics.outboundBytes / 2 ** 30,
        unit: "GB",
        comment: "https://aws.amazon.com/ec2/pricing/on-demand/#Data_Transfer"
    });
    costs.push(outboundDataTransfer);

    const sqs: CostMetric = new CostMetric({
        name: "sqs",
        pricing: prices.sqsPer64kRequest,
        measured: metrics.sqs64kRequests,
        unit: "request",
        comment: "https://aws.amazon.com/sqs/pricing"
    });
    costs.push(sqs);

    const sns: CostMetric = new CostMetric({
        name: "sns",
        pricing: prices.snsPer64kPublish,
        measured: metrics.sns64kRequests,
        unit: "request",
        comment: "https://aws.amazon.com/sns/pricing"
    });
    costs.push(sns);

    return Promise.resolve(costs);
}
