require("source-map-support").install();

import * as aws from "aws-sdk";
import { AxiosPromise, AxiosResponse } from "axios";
import * as commander from "commander";
import { cloudfunctions_v1, google } from "googleapis";
import * as inquirer from "inquirer";
import * as ora from "ora";
import * as awsCloudify from "./aws/aws-cloudify";
import { LocalCache } from "./cache";
import { RateLimitedFunnel } from "./funnel";
import * as googleCloudify from "./google/google-cloudify";

const warn = console.warn;
const log = console.log;

interface CleanupAWSOptions {
    region: string;
    execute: boolean;
    cleanAll: boolean;
    print?: boolean;
}

async function deleteResources(
    name: string,
    matchingResources: string[],
    remove: (arg: string) => Promise<any>,
    { maxConcurrency = 10, targetRequestsPerSecond = 5, maxBurst = 5 } = {}
) {
    if (matchingResources.length > 0) {
        const timeEstimate = (nResources: number) =>
            nResources <= 5 ? "" : `(est: ${(nResources / 5).toFixed(0)}s)`;
        const updateSpinnerText = (nResources: number = 0) =>
            `Deleting ${matchingResources.length} ${name} ${timeEstimate(nResources)}`;
        const spinner = ora(updateSpinnerText(matchingResources.length)).start();
        const funnel = new RateLimitedFunnel({
            maxConcurrency,
            targetRequestsPerSecond,
            maxBurst
        });
        const timer = setInterval(
            () => (spinner.text = updateSpinnerText(funnel.size())),
            1000
        );
        try {
            await Promise.all(
                matchingResources.map(resource =>
                    funnel.pushRetry(3, () => remove(resource))
                )
            );
        } finally {
            clearInterval(timer);
            spinner.text = updateSpinnerText();
        }
        spinner.stopAndPersist({ symbol: "✔" });
    }
}

async function cleanupAWS({ region, execute, cleanAll }: CleanupAWSOptions) {
    let nResources = 0;
    const output = (msg: string) => !execute && log(msg);
    const { cloudwatch, iam, lambda, sns, sqs, s3 } = awsCloudify.createAWSApis(region);

    function listAWSResource<T, U>(
        pattern: RegExp,
        getList: () => aws.Request<T, aws.AWSError>,
        extractList: (arg: T) => U[] | undefined,
        extractElement: (arg: U) => string | undefined
    ) {
        const allResources: string[] = [];
        return new Promise<string[]>((resolve, reject) => {
            getList().eachPage((err, page) => {
                if (err) {
                    reject(err);
                    return false;
                }
                const elems = (page && extractList(page)) || [];
                allResources.push(...elems.map(elem => extractElement(elem) || ""));
                if (page === null) {
                    const matchingResources = allResources.filter(t => t.match(pattern));
                    matchingResources.forEach(resource => output(`  ${resource}`));
                    resolve(matchingResources);
                }
                return true;
            });
        });
    }

    async function deleteAWSResource<T, U>(
        name: string,
        pattern: RegExp,
        getList: () => aws.Request<T, aws.AWSError>,
        extractList: (arg: T) => U[] | undefined,
        extractElement: (arg: U) => string | undefined,
        remove: (arg: string) => Promise<any>
    ) {
        const allResources = await listAWSResource(
            pattern,
            getList,
            extractList,
            extractElement
        );
        nResources += allResources.length;
        if (execute) {
            await deleteResources(name, allResources, remove, {
                maxConcurrency: 10,
                targetRequestsPerSecond: 5,
                maxBurst: 5
            });
        }
    }

    output(`SNS subscriptions`);
    await deleteAWSResource(
        "SNS subscription(s)",
        /:cloudify-/,
        () => sns.listSubscriptions(),
        page => page.Subscriptions,
        subscription => subscription.SubscriptionArn,
        SubscriptionArn => sns.unsubscribe({ SubscriptionArn }).promise()
    );

    output(`SNS topics`);
    await deleteAWSResource(
        "SNS topic(s)",
        /:cloudify-/,
        () => sns.listTopics(),
        page => page.Topics,
        topic => topic.TopicArn,
        TopicArn => sns.deleteTopic({ TopicArn }).promise()
    );

    output(`SQS queues`);
    await deleteAWSResource(
        "SQS queue(s)",
        /\/cloudify-/,
        () => sqs.listQueues(),
        page => page.QueueUrls,
        queueUrl => queueUrl,
        QueueUrl => sqs.deleteQueue({ QueueUrl }).promise()
    );

    output(`Lambda functions`);
    await deleteAWSResource(
        "Lambda function(s)",
        /^cloudify-/,
        () => lambda.listFunctions(),
        page => page.Functions,
        func => func.FunctionName,
        FunctionName => lambda.deleteFunction({ FunctionName }).promise()
    );

    output(`IAM roles`);
    await deleteAWSResource(
        "IAM role(s)",
        cleanAll ? /^cloudify-/ : /^cloudify-(?!cached)/,
        () => iam.listRoles(),
        page => page.Roles,
        role => role.RoleName,
        RoleName => awsCloudify.deleteRole(RoleName, iam)
    );

    output(`S3 bucket keys`);
    const buckets = await listAWSResource(
        /^cloudify-/,
        () => s3.listBuckets(),
        page => page.Buckets,
        bucket => bucket.Name
    );
    for (const Bucket of buckets) {
        await deleteAWSResource(
            "S3 Bucket key(s)",
            /./,
            () => s3.listObjectsV2({ Bucket }),
            object => object.Contents,
            content => content.Key,
            Key => s3.deleteObject({ Key, Bucket }).promise()
        );
    }

    output(`S3 buckets`);
    await deleteAWSResource(
        "S3 Bucket(s)",
        /^cloudify-/,
        () => s3.listBuckets(),
        page => page.Buckets,
        bucket => bucket.Name,
        Bucket => s3.deleteBucket({ Bucket }).promise()
    );

    const cache = new LocalCache("aws");
    output(`Local cache: ${cache.dir}`);
    const entries = cache.entries();
    if (!execute) {
        output(`  cache entries: ${entries.length}`);
    }
    nResources += entries.length;
    if (execute) {
        cache.clear();
    }

    output(`Cloudwatch log groups`);
    await deleteAWSResource(
        "Cloudwatch log group(s)",
        /\/cloudify-/,
        () => cloudwatch.describeLogGroups(),
        page => page.logGroups,
        logGroup => logGroup.logGroupName,
        logGroupName => cloudwatch.deleteLogGroup({ logGroupName }).promise()
    );

    return nResources;
}

interface CleanupGoogleOptions {
    region: string;
    execute: boolean;
    print?: boolean;
}

interface HasNextPageToken {
    nextPageToken?: string;
}

async function iterate<T extends HasNextPageToken>(
    getPage: (token?: string) => AxiosPromise<T>,
    each: (val: T) => void
) {
    let token;
    do {
        const result: AxiosResponse<T> = await getPage(token);
        each(result.data);
        token = result.data.nextPageToken;
    } while (token);
}

async function cleanupGoogle({ execute }: CleanupGoogleOptions) {
    let nResources = 0;
    const output = (msg: string) => !execute && log(msg);

    async function listGoogleResource<T, U>(
        pattern: RegExp,
        getList: (pageToken?: string) => AxiosPromise<T>,
        extractList: (arg: T) => U[] | undefined,
        extractElement: (arg: U) => string | undefined
    ) {
        const allResources: string[] = [];
        await iterate(
            pageToken => getList(pageToken),
            result => {
                const resources = extractList(result) || [];
                allResources.push(...resources.map(elem => extractElement(elem) || ""));
            }
        );

        const matchingResources = allResources.filter(t => t.match(pattern));
        matchingResources.forEach(resource => output(`  ${resource}`));
        return matchingResources;
    }

    async function deleteGoogleResource<T, U>(
        name: string,
        pattern: RegExp,
        getList: (pageToken?: string) => AxiosPromise<T>,
        extractList: (arg: T) => U[] | undefined,
        extractElement: (arg: U) => string | undefined,
        remove: (arg: string) => Promise<any>
    ) {
        const allResources = await listGoogleResource(
            pattern,
            getList,
            extractList,
            extractElement
        );
        nResources += allResources.length;
        if (execute) {
            await deleteResources(name, allResources, remove, {
                maxConcurrency: 20,
                targetRequestsPerSecond: 20,
                maxBurst: 20
            });
        }
    }
    const { cloudFunctions, pubsub } = await googleCloudify.initializeGoogleServices();
    const project = await google.auth.getProjectId();
    log(`Default project: ${project}`);

    output(`Cloud functions`);
    await deleteGoogleResource(
        "Cloud Function(s)",
        /cloudify-/,
        (pageToken?: string) =>
            cloudFunctions.projects.locations.functions.list({
                pageToken,
                parent: `projects/${project}/locations/-`
            }),
        page => page.functions,
        func => func.name,
        name => cloudFunctions.projects.locations.functions.delete({ name })
    );

    output(`Pub/Sub subscriptions`);
    await deleteGoogleResource(
        "Pub/Sub Subscription(s)",
        /cloudify-/,
        pageToken =>
            pubsub.projects.subscriptions.list({
                pageToken,
                project: `projects/${project}`
            }),
        page => page.subscriptions,
        subscription => subscription.name,
        subscriptionName =>
            pubsub.projects.subscriptions.delete({ subscription: subscriptionName })
    );

    output(`Pub/Sub topics`);
    await deleteGoogleResource(
        "Pub/Sub topic(s)",
        /topics\/cloudify-/,
        pageToken =>
            pubsub.projects.topics.list({ pageToken, project: `projects/${project}` }),
        page => page.topics,
        topic => topic.name,
        topicName => pubsub.projects.topics.delete({ topic: topicName })
    );

    return nResources;
}

async function prompt() {
    const answer = await inquirer.prompt<any>([
        {
            type: "confirm",
            name: "execute",
            message: "WARNING: this operation will delete resources. Confirm?",
            default: false
        }
    ]);
    if (!answer.execute) {
        log(`Execution aborted.`);
        process.exit(0);
    }
}

async function main() {
    let cloud!: string;
    commander
        .version("0.1.0")
        .option("-v, --verbose", "Verbose mode")
        .option(
            "-a, --all",
            `Removes the IAM 'cloudify-cached-*' roles, which are used to speed cloudify startup.`
        )
        .option(
            "-x, --execute",
            "Execute the cleanup process. If this option is not specified, the output will be a dry run."
        )
        .option("-f, --force", "When used with -x, skips the prompt")
        .option(
            "-r, --region <region>",
            "Region to clean up. Defaults to us-west-2 for AWS, and us-central1 for Google."
        )
        .arguments("<cloud>")
        .action(arg => {
            cloud = arg;
        })
        .description(
            `Cleanup cloudify resources that may have leaked. The <cloud> argument must be "aws" or "google".
  By default the output is a dry run and will only print the actions that would be performed if '-x' is specified.`
        );

    commander.parse(process.argv);
    if (commander.verbose) {
        process.env.DEBUG = "cloudify:*";
    }
    const execute = commander.execute || false;
    let region = commander.region;

    if (!region) {
        switch (cloud) {
            case "aws":
                region = awsCloudify.defaults.region;
                break;
            case "google":
                region = googleCloudify.defaults.region;
                break;
        }
    }
    const force = commander.force || false;
    const cleanAll = commander.all || false;

    log(`Region: ${region}`);
    let nResources = 0;
    if (execute && !force) {
        if (cloud === "aws") {
            nResources = await cleanupAWS({ region, execute: false, cleanAll });
        } else if (cloud === "google") {
            nResources = await cleanupGoogle({ region, execute: false });
        } else {
            warn(`Unknown cloud name ${commander.cloud}. Must specify "aws" or "google"`);
            process.exit(-1);
        }

        if (nResources === 0) {
            log(`No resources to clean up.`);
            process.exit(0);
        }
        await prompt();
    }

    if (cloud === "aws") {
        await cleanupAWS({ region, execute, cleanAll });
    } else if (cloud === "google") {
        await cleanupGoogle({ region, execute });
    } else {
        warn(`Unknown cloud name ${commander.cloud}. Must specify "aws" or "google"`);
        process.exit(-1);
    }
    if (execute) {
        log(`Done.`);
    } else {
        log(`(dryrun mode, no resources will be deleted, specify -x to execute cleanup)`);
    }
}

main();
