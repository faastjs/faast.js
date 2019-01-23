import * as aws from "aws-sdk";
import { PromiseResult } from "aws-sdk/lib/request";
import { createHash } from "crypto";
import { caches } from "../cache";
import { CostBreakdown, CostMetric } from "../cost";
import { createFunction } from "../faast";
import { readFile } from "../fs";
import { info, logGc, warn } from "../log";
import { packer, PackerResult } from "../packer";
import {
    CloudFunctionImpl,
    FunctionCounters,
    FunctionStats,
    Invocation,
    PollResult,
    ResponseMessage,
    SendableMessage,
    CommonOptions,
    CommonOptionDefaults,
    CleanupOptions,
    PackerOptions,
    UUID
} from "../provider";
import {
    assertNever,
    computeHttpResponseBytes,
    defined,
    hasExpired,
    sleep,
    uuidv4Pattern
} from "../shared";
import { retry, throttle } from "../throttle";
import * as awsNpm from "./aws-npm";
import {
    createSNSTopic,
    createSQSQueue,
    processAWSErrorMessage,
    publishInvocationMessage,
    sendResponseQueueMessage,
    receiveMessages
} from "./aws-queue";
import { getLogGroupName, getLogUrl } from "./aws-shared";
import * as awsTrampoline from "./aws-trampoline";
import { FunctionReturn } from "../wrapper";

export interface Options extends CommonOptions {
    region?: AWSRegion;
    PolicyArn?: string;
    RoleName?: string;
    useDependencyCaching?: boolean;
    awsLambdaOptions?: Partial<aws.Lambda.Types.CreateFunctionRequest>;
    CacheBucket?: string;
    gcWorker?: (services: AWSServices, work: GcWork) => Promise<void>;
}

export interface AWSPrices {
    lambdaPerRequest: number;
    lambdaPerGbSecond: number;
    snsPer64kPublish: number;
    sqsPer64kRequest: number;
    dataOutPerGb: number;
    logsIngestedPerGb: number;
}

export class AWSMetrics {
    outboundBytes = 0;
    sns64kRequests = 0;
    sqs64kRequests = 0;
}

export interface AWSResources {
    FunctionName: string;
    RoleName: string;
    region: AWSRegion;
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
    readonly sts: aws.STS;
}

type AWSInvocationResponse = PromiseResult<aws.Lambda.InvocationResponse, aws.AWSError>;

export interface State {
    resources: AWSResources;
    services: AWSServices;
    options: Required<Options>;
    metrics: AWSMetrics;
    gcPromise?: Promise<void>;
}

export type GcWork =
    | {
          type: "SetLogRetention";
          logGroupName: string;
          retentionInDays: number;
      }
    | {
          type: "DeleteResources";
          resources: AWSResources;
      };

const defaultGcWorker = throttle(
    { concurrency: 5, rate: 5, burst: 2 },
    async (services: AWSServices, work: GcWork) => {
        switch (work.type) {
            case "SetLogRetention":
                if (
                    await quietly(
                        services.cloudwatch.putRetentionPolicy({
                            ...work
                        })
                    )
                ) {
                    logGc(
                        `Added retention policy of ${work.retentionInDays} day(s) to ${
                            work.logGroupName
                        }`
                    );
                }
                break;
            case "DeleteResources":
                await deleteResources(work.resources, services, logGc);
                break;
        }
    }
);

export let defaults: Required<Options> = {
    ...CommonOptionDefaults,
    region: "us-west-2",
    PolicyArn: "arn:aws:iam::aws:policy/AdministratorAccess",
    RoleName: "faast-cached-lambda-role",
    memorySize: 1728,
    useDependencyCaching: true,
    awsLambdaOptions: {},
    CacheBucket: "",
    gcWorker: defaultGcWorker
};

export const Impl: CloudFunctionImpl<Options, State> = {
    provider: "aws",
    initialize,
    pack,
    defaults,
    cleanup,
    costEstimate,
    logUrl,
    invoke,
    publish,
    poll,
    responseQueueId
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

export function createAWSApis(region: string): AWSServices {
    aws.config.update({ correctClockSkew: true });
    const services = {
        iam: new aws.IAM({ apiVersion: "2010-05-08", region }),
        lambda: new aws.Lambda({ apiVersion: "2015-03-31", region }),
        cloudwatch: new aws.CloudWatchLogs({ apiVersion: "2014-03-28", region }),
        sqs: new aws.SQS({ apiVersion: "2012-11-05", region }),
        sns: new aws.SNS({ apiVersion: "2010-03-31", region }),
        s3: new aws.S3({ apiVersion: "2006-03-01", region }),
        pricing: new aws.Pricing({ region: "us-east-1" }),
        sts: new aws.STS({ apiVersion: "2011-06-15", region })
    };
    return services;
}

const createLambdaRole = throttle(
    { concurrency: 1, rate: 5, memoize: true },
    async (RoleName: string, PolicyArn: string, services: AWSServices) => {
        const { iam } = services;
        info(`Checking for cached lambda role`);
        const previousRole = await quietly(iam.getRole({ RoleName }));
        if (previousRole) {
            return previousRole.Role.Arn;
        }
        info(`Creating role "${RoleName}" for faast trampoline function`);
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
            Description: "role for lambda functions created by faast",
            MaxSessionDuration: 3600
        };
        info(`Calling createRole`);
        const roleResponse = await iam.createRole(roleParams).promise();
        info(`Attaching role policy`);
        await iam.attachRolePolicy({ RoleName, PolicyArn }).promise();
        return roleResponse.Role.Arn;
    }
);

export async function pollAWSRequest<T>(
    n: number,
    description: string,
    fn: () => aws.Request<T, aws.AWSError>
) {
    let duration = 1000;
    for (let i = 1; i < n; i++) {
        info(`Polling ${description}...`);
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

const createCacheBucket = throttle(
    { concurrency: 1, rate: 10, retry: 3, memoize: true },
    async (s3: aws.S3, Bucket: string, region: string) => {
        info(`Checking for cache bucket`);
        const bucket = await quietly(s3.getBucketLocation({ Bucket }));
        if (bucket) {
            return;
        }
        info(`Creating cache bucket`);
        const createdBucket = await s3
            .createBucket({
                Bucket,
                CreateBucketConfiguration: { LocationConstraint: region }
            })
            .promise();
        if (createdBucket) {
            info(`Setting lifecycle expiration to 1 day for cached objects`);
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
);

function getBucketName(region: string, accountId: string) {
    return `faast-cache-${accountId}-${region}`;
}

function getS3Key(FunctionName: string) {
    return FunctionName;
}

export async function buildModulesOnLambda(
    s3: aws.S3,
    region: string,
    Bucket: string,
    packageJson: string | object,
    indexContents: Promise<string>,
    FunctionName: string,
    useDependencyCaching: boolean
): Promise<aws.Lambda.FunctionCode> {
    info(`Building node_modules`);

    const packageJsonContents =
        typeof packageJson === "string"
            ? (await readFile(packageJson)).toString()
            : JSON.stringify(packageJson);

    const localCache = await caches.awsPackage;

    let cacheKey: string | undefined;
    if (useDependencyCaching) {
        const hasher = createHash("sha256");
        hasher.update(packageJsonContents);
        cacheKey = hasher.digest("hex");

        const localCacheEntry = await localCache.get(cacheKey);
        if (localCacheEntry) {
            info(`Using local cache entry ${localCache.dir}/${cacheKey}`);

            const stream = await awsNpm.addIndexToPackage(localCacheEntry, indexContents);
            const buf = await zipStreamToBuffer(stream);
            return { ZipFile: buf };
        }
    }

    await createCacheBucket(s3, Bucket, region);

    const lambda = await createFunction(awsNpm, require.resolve("./aws-npm"), Impl, {
        timeout: 300,
        memorySize: 2048,
        mode: "https"
    });
    try {
        const Key = getS3Key(FunctionName);

        const installArgs: awsNpm.NpmInstallArgs = {
            packageJsonContents,
            indexContents: await indexContents,
            Bucket,
            Key,
            cacheKey
        };
        const installLog = await lambda.functions.npmInstall(installArgs);
        info(installLog);

        if (cacheKey) {
            const cachedPackage = await s3.getObject({ Bucket, Key: cacheKey }).promise();
            await localCache.set(cacheKey, cachedPackage.Body!);
        }
        return { S3Bucket: Bucket, S3Key: Key };
    } catch (err) {
        warn(err);
        throw err;
    } finally {
        await lambda.cleanup();
    }
}

export function logUrl(state: State) {
    const { region, FunctionName } = state.resources;
    return getLogUrl(region, FunctionName);
}

export async function initialize(
    fModule: string,
    nonce: UUID,
    options: Required<Options>
): Promise<State> {
    info(`Nonce: ${nonce}`);

    const { region, timeout, memorySize } = options;

    info(`Creating AWS APIs`);
    const services = createAWSApis(region);
    const { lambda, s3, sts } = services;
    const FunctionName = `faast-${nonce}`;
    const accountId = await getAccountId(sts);
    const CacheBucket = options.CacheBucket || getBucketName(region, accountId);

    async function createFunction(Code: aws.Lambda.FunctionCode, Role: string) {
        const createFunctionRequest: aws.Lambda.Types.CreateFunctionRequest = {
            FunctionName,
            Role,
            // Runtime: "nodejs6.10",
            Runtime: "nodejs8.10",
            Handler: "index.trampoline",
            Code,
            Description: "faast trampoline function",
            Timeout: timeout,
            MemorySize: memorySize,
            ...options.awsLambdaOptions
        };
        info(`createFunctionRequest: %O`, createFunctionRequest);
        const func = await pollAWSRequest(3, "creating function", () =>
            lambda.createFunction(createFunctionRequest)
        );
        info(`Created function ${func.FunctionName}, FunctionArn: ${func.FunctionArn}`);
        return func;
    }

    const { packageJson, useDependencyCaching } = options;

    async function createCodeBundle() {
        const bundle = pack(fModule, options);

        let Code: aws.Lambda.FunctionCode;
        if (packageJson) {
            Code = await buildModulesOnLambda(
                s3,
                region,
                CacheBucket,
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

    const { RoleName } = options;
    const state: State = {
        resources: {
            FunctionName,
            RoleName,
            region,
            logGroupName: getLogGroupName(FunctionName)
        },
        services,
        metrics: new AWSMetrics(),
        options
    };

    const { gc, retentionInDays, gcWorker } = options;
    if (gc) {
        logGc(`Starting garbage collector`);
        state.gcPromise = collectGarbage(
            gcWorker,
            services,
            region,
            accountId,
            CacheBucket,
            retentionInDays
        );
        state.gcPromise.catch(_silenceWarningLackOfSynchronousCatch => {});
    }

    const { PolicyArn } = options;
    try {
        info(`Creating function`);
        const rolePromise = createLambdaRole(RoleName, PolicyArn, services);

        const createFunctionPromise = Promise.all([createCodeBundle(), rolePromise]).then(
            ([codeBundle, roleArn]) => {
                if (codeBundle.S3Bucket) {
                    state.resources.s3Bucket = codeBundle.S3Bucket;
                    state.resources.s3Key = codeBundle.S3Key;
                }
                return createFunction(codeBundle, roleArn);
            }
        );

        const pricingPromise = requestAwsPrices(services.pricing, region);
        const promises: Promise<any>[] = [createFunctionPromise, pricingPromise];

        info(`Creating response queue`);
        promises.push(
            createFunctionPromise.then(_ =>
                createResponseQueueImpl(state, FunctionName).then(_ =>
                    retry(3, () =>
                        lambda
                            .updateFunctionConfiguration({
                                FunctionName,
                                DeadLetterConfig: {
                                    TargetArn: state.resources.ResponseQueueArn
                                }
                            })
                            .promise()
                    ).catch(err => {
                        warn(err);
                        warn(`Could not add DLQ to function, continuing without it.`);
                    })
                )
            )
        );

        const { mode } = options;
        if (mode === "queue" || mode === "auto") {
            promises.push(
                createFunctionPromise.then(async func =>
                    createRequestQueueImpl(state, FunctionName, func.FunctionArn!)
                )
            );
        }

        await Promise.all(promises);
        info(`Lambda function initialization complete.`);
        return state;
    } catch (err) {
        const newError = new Error("Could not initialize cloud function");
        warn(`ERROR: ${newError}`);
        warn(`${newError.stack}`);
        warn(`Underlying error: ${err}`);
        await cleanup(state, { deleteResources: true });
        throw err;
    }
}

async function invoke(state: State, call: Invocation): Promise<ResponseMessage | void> {
    const { metrics, services, resources, options } = state;
    switch (options.mode) {
        case "https":
            const { lambda } = services;
            const { FunctionName } = resources;
            return invokeHttps(lambda, FunctionName, call, metrics);
        case "queue":
        case "auto":
            const { sns } = services;
            const { RequestTopicArn } = resources;
            await publishInvocationMessage(sns, RequestTopicArn!, call, metrics);
            return;
        default:
            assertNever(options.mode);
    }
}

function publish(state: State, message: SendableMessage): Promise<void> {
    const { services, resources } = state;
    return sendResponseQueueMessage(services.sqs, resources.ResponseQueueUrl!, message);
}

function poll(state: State): Promise<PollResult> {
    return receiveMessages(
        state.services.sqs,
        state.resources.ResponseQueueUrl!,
        state.metrics
    );
}

function responseQueueId(state: State): string | undefined {
    return state.resources.ResponseQueueUrl;
}

async function invokeHttps(
    lambda: aws.Lambda,
    FunctionName: string,
    message: Invocation,
    metrics: AWSMetrics
): Promise<ResponseMessage> {
    let body: string | FunctionReturn;
    let rawResponse: AWSInvocationResponse;

    const request: aws.Lambda.Types.InvocationRequest = {
        FunctionName,
        Payload: message.body,
        LogType: "None"
    };
    const awsRequest = lambda.invoke(request);
    rawResponse = await awsRequest.promise();
    if (rawResponse.LogResult) {
        info(Buffer.from(rawResponse.LogResult!, "base64").toString());
    }
    if (rawResponse.FunctionError) {
        const response = processAWSErrorMessage(rawResponse.Payload as string);
        body = {
            type: "error",
            callId: message.callId,
            value: new Error(response)
        };
    } else {
        body = rawResponse.Payload! as string;
    }
    metrics.outboundBytes += computeHttpResponseBytes(
        rawResponse.$response.httpResponse.headers
    );
    return {
        kind: "response",
        callId: message.callId,
        body,
        rawResponse,
        timestamp: Date.now()
    };
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

async function deleteResources(
    resources: Partial<AWSResources>,
    services: AWSServices,
    output: (msg: string) => void = info
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

    const { lambda, sqs, sns, s3, iam } = services;
    if (SNSLambdaSubscriptionArn) {
        if (
            await quietly(sns.unsubscribe({ SubscriptionArn: SNSLambdaSubscriptionArn }))
        ) {
            output(`Deleted request queue subscription to lambda`);
        }
    }
    if (RoleName) {
        await deleteRole(RoleName, iam);
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
        if (await quietly(services.cloudwatch.deleteLogGroup({ logGroupName }))) {
            logGc(`Deleted log group ${logGroupName}`);
        }
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
        info(`Added 1 day retention policy to log group ${logGroupName}`);
    }
}

export async function cleanup(state: State, options: Required<CleanupOptions>) {
    info(`aws cleanup starting.`);
    await addLogRetentionPolicy(state.resources.FunctionName, state.services.cloudwatch);
    if (state.gcPromise) {
        info(`Waiting for garbage collection...`);
        await state.gcPromise;
        info(`Garbage collection done.`);
    }

    if (options.deleteResources) {
        info(`Cleaning up faast infrastructure for ${state.resources.FunctionName}...`);
        // Don't delete cached role. It may be in use by other instances of faast.
        // Don't delete logs. They are often useful. By default log stream retention will
        // be 1 day, and gc will clean out the log group after the streams are expired.
        const { logGroupName, RoleName, ...rest } = state.resources;
        await deleteResources(rest, state.services);
    }
    info(`aws cleanup done.`);
}

let garbageCollectorRunning = false;

const logGroupNameRegexp = new RegExp(`^/aws/lambda/(faast-${uuidv4Pattern})$`);

function functionNameFromLogGroup(logGroupName: string) {
    const match = logGroupName.match(logGroupNameRegexp);
    return match && match[1];
}

export async function collectGarbage(
    executor: (services: AWSServices, work: GcWork) => Promise<void>,
    services: AWSServices,
    region: AWSRegion,
    accountId: string,
    Bucket: string,
    retentionInDays: number
) {
    if (garbageCollectorRunning) {
        return;
    }
    garbageCollectorRunning = true;
    try {
        const promises: Promise<void>[] = [];
        function scheduleWork(work: GcWork) {
            promises.push(executor(services, work));
        }
        const throttlePaging = throttle({ concurrency: 1, rate: 3 }, async () => {});
        const functionsWithLogGroups = new Set();

        // Collect functions with log groups
        await new Promise((resolve, reject) =>
            services.cloudwatch
                .describeLogGroups({ logGroupNamePrefix: "/aws/lambda/faast-" })
                .eachPage((err, page, done) => {
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
                            page.logGroups!,
                            retentionInDays,
                            region,
                            accountId,
                            Bucket,
                            scheduleWork
                        );
                    }
                    throttlePaging().then(done);
                    return true;
                })
        );

        // Collect functions without log groups
        await new Promise((resolve, reject) =>
            services.lambda.listFunctions().eachPage((err, page, done) => {
                if (err) {
                    warn(`GC: Error listing lambda functions: ${err}`);
                    reject(err);
                    return false;
                }
                if (page === null) {
                    resolve();
                } else {
                    const fnPattern = new RegExp(`^faast-${uuidv4Pattern}$`);
                    const funcs = (page.Functions || [])
                        .filter(fn => fn.FunctionName!.match(fnPattern))
                        .filter(fn => !functionsWithLogGroups.has(fn.FunctionName))
                        .filter(fn => hasExpired(fn.LastModified, retentionInDays))
                        .map(fn => fn.FunctionName!);

                    deleteGarbageFunctions(
                        region,
                        accountId,
                        Bucket,
                        funcs,
                        scheduleWork
                    );
                    throttlePaging().then(done);
                }
                return true;
            })
        );

        await Promise.all(promises);
    } finally {
        garbageCollectorRunning = false;
    }
}

export async function getAccountId(sts: aws.STS) {
    const response = await sts.getCallerIdentity().promise();
    const { Account, Arn, UserId } = response;
    info(`Account ID: %O`, { Account, Arn, UserId });
    return response.Account!;
}

function garbageCollectLogGroups(
    logGroups: aws.CloudWatchLogs.LogGroup[],
    retentionInDays: number,
    region: AWSRegion,
    accountId: string,
    s3Bucket: string,
    scheduleWork: (work: GcWork) => void
) {
    const logGroupsMissingRetentionPolicy = logGroups.filter(
        g => g.retentionInDays === undefined
    );

    logGroupsMissingRetentionPolicy.forEach(g =>
        scheduleWork({
            type: "SetLogRetention",
            logGroupName: g.logGroupName!,
            retentionInDays
        })
    );

    const garbageFunctions = logGroups
        .filter(g => hasExpired(g.creationTime, retentionInDays))
        .filter(g => g.storedBytes! === 0)
        .map(g => functionNameFromLogGroup(g.logGroupName!))
        .filter(defined);

    deleteGarbageFunctions(region, accountId, s3Bucket, garbageFunctions, scheduleWork);
}

function deleteGarbageFunctions(
    region: AWSRegion,
    accountId: string,
    s3Bucket: string,
    garbageFunctions: string[],
    scheduleWork: (work: GcWork) => void
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
        scheduleWork({ type: "DeleteResources", resources });
    });
}

export async function pack(
    functionModule: string,
    options?: PackerOptions
): Promise<PackerResult> {
    const { webpackOptions, ...rest }: PackerOptions = options || {};
    return packer(awsTrampoline, functionModule, {
        webpackOptions: { externals: "aws-sdk", ...webpackOptions },
        ...rest
    });
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

function createRequestQueueImpl(state: State, FunctionName: string, FunctionArn: string) {
    const { sns, lambda } = state.services;
    const { resources, metrics } = state;

    info(`Creating SNS request topic`);
    const createTopicPromise = createSNSTopic(sns, getSNSTopicName(FunctionName));

    const assignRequestTopicArnPromise = createTopicPromise.then(
        topic => (resources.RequestTopicArn = topic)
    );

    const addPermissionsPromise = createTopicPromise.then(topic => {
        info(`Adding SNS invoke permissions to function`);
        return addSnsInvokePermissionsToFunction(FunctionName, topic, lambda);
    });

    const subscribePromise = createTopicPromise.then(topic => {
        info(`Subscribing SNS to invoke lambda function`);
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

    return Promise.all([
        createTopicPromise,
        assignRequestTopicArnPromise,
        addPermissionsPromise,
        subscribePromise,
        assignSNSResponsePromise
    ]);
}

export function createResponseQueueImpl(state: State, FunctionName: string) {
    const { sqs } = state.services;
    const { resources, metrics } = state;
    info(`Creating SQS response queue`);
    return createSQSQueue(getSQSName(FunctionName), 60, sqs).then(
        ({ QueueUrl, QueueArn }) => {
            resources.ResponseQueueUrl = QueueUrl;
            resources.ResponseQueueArn = QueueArn;
            info(`Created response queue`);
        }
    );
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
type AWSRegion =
    | "us-east-1"
    | "us-east-2"
    | "us-west-1"
    | "us-west-2"
    | "ca-central-1"
    | "eu-central-1"
    | "eu-west-1"
    | "eu-west-2"
    | "eu-west-3"
    | "ap-northeast-1"
    | "ap-northeast-2"
    | "ap-northeast-3"
    | "ap-southeast-1"
    | "ap-southeast-2"
    | "ap-south-1"
    | "sa-east-1";

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

export const awsPrice = throttle(
    { concurrency: 6, rate: 5, retry: 3, memoize: true, cache: caches.awsPrices },
    async (
        pricing: aws.Pricing,
        ServiceCode: string,
        filter: { [key: string]: string }
    ) => {
        try {
            function first(obj: any) {
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
                priceResult.PriceList!.forEach(p => warn(`%O`, p));
            }
            const pList: any = priceResult.PriceList![0];
            const price = extractPrice(first(pList.terms.OnDemand));
            return price;
        } catch (err) {
            if (!err.message.match(/Rate exceeded/)) {
                warn(`Could not get AWS pricing for '${ServiceCode}' (%O)`, filter);
                warn(err);
            }
            throw err;
        }
    }
);

export const requestAwsPrices = async (
    pricing: aws.Pricing,
    region: AWSRegion
): Promise<AWSPrices> => {
    const location = locations[region];
    return {
        lambdaPerRequest: await awsPrice(pricing, "AWSLambda", {
            location,
            group: "AWS-Lambda-Requests"
        }).catch(_ => 0.0000002),
        lambdaPerGbSecond: await awsPrice(pricing, "AWSLambda", {
            location,
            group: "AWS-Lambda-Duration"
        }).catch(_ => 0.00001667),
        snsPer64kPublish: await awsPrice(pricing, "AmazonSNS", {
            location,
            group: "SNS-Requests-Tier1"
        }).catch(_ => 0.5 / 1e6),
        sqsPer64kRequest: await awsPrice(pricing, "AWSQueueService", {
            location,
            group: "SQS-APIRequest-Tier1",
            queueType: "Standard"
        }).catch(_ => 0.4 / 1e6),
        dataOutPerGb: await awsPrice(pricing, "AWSDataTransfer", {
            fromLocation: location,
            transferType: "AWS Outbound"
        }).catch(_ => 0.09),
        logsIngestedPerGb: await awsPrice(pricing, "AmazonCloudWatch", {
            location,
            group: "Ingested Logs",
            groupDescription: "Existing system, application, and custom log files"
        }).catch(_ => 0.5)
    };
};

export async function costEstimate(
    state: State,
    counters: FunctionCounters,
    statistics: FunctionStats
): Promise<CostBreakdown> {
    const costs = new CostBreakdown();
    const { region } = state.resources;
    const prices = await requestAwsPrices(state.services.pricing, region);

    const { memorySize = defaults.memorySize } = state.options;
    const billedTimeStats = statistics.estimatedBilledTime;
    const seconds = (billedTimeStats.mean / 1000) * billedTimeStats.samples || 0;
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
        measured: counters.invocations,
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

    const logIngestion: CostMetric = new CostMetric({
        name: "logIngestion",
        pricing: prices.logsIngestedPerGb,
        measured: 0,
        unit: "GB",
        comment:
            "https://aws.amazon.com/cloudwatch/pricing/ - Log ingestion costs not currently included.",
        alwaysZero: true
    });
    costs.push(logIngestion);

    return costs;
}
