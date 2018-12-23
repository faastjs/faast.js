require("source-map-support").install();

import * as aws from "aws-sdk";
import { AxiosPromise, AxiosResponse } from "axios";
import * as commander from "commander";
import { google } from "googleapis";
import * as inquirer from "inquirer";
import * as ora from "ora";
import { tmpdir } from "os";
import * as path from "path";
import * as awsFaast from "./aws/aws-faast";
import { LocalCache } from "./cache";
import { readdir, rmrf } from "./fs";
import * as googleFaast from "./google/google-faast";
import { throttle } from "./throttle";

const warn = console.warn;
const log = console.log;

interface CleanupOptions {
    region?: string; // AWS and Google only.
    execute: boolean;
    cleanAll?: boolean; // AWS only
}

async function deleteResources(
    name: string,
    matchingResources: string[],
    remove: (arg: string) => Promise<any>,
    { concurrency = 10, rate = 5, burst = 5 } = {}
) {
    if (matchingResources.length > 0) {
        const timeEstimate = (nResources: number) =>
            nResources <= 5 ? "" : `(est: ${(nResources / 5).toFixed(0)}s)`;
        const updateSpinnerText = (nResources: number = 0) =>
            `Deleting ${matchingResources.length} ${name} ${timeEstimate(nResources)}`;
        const spinner = ora(updateSpinnerText(matchingResources.length)).start();
        let done = 0;
        const scheduleRemove = throttle(
            {
                concurrency,
                rate,
                burst,
                retry: 3
            },
            async arg => {
                await remove(arg);
                done++;
            }
        );
        const timer = setInterval(
            () => (spinner.text = updateSpinnerText(matchingResources.length - done)),
            1000
        );
        try {
            await Promise.all(
                matchingResources.map(resource => scheduleRemove(resource))
            );
        } finally {
            clearInterval(timer);
            spinner.text = updateSpinnerText();
        }
        spinner.stopAndPersist({ symbol: "✔" });
    }
}

async function cleanupAWS({ region, execute, cleanAll }: CleanupOptions) {
    let nResources = 0;
    const output = (msg: string) => !execute && log(msg);
    const { cloudwatch, iam, lambda, sns, sqs, s3 } = awsFaast.createAWSApis(region!);

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
                concurrency: 10,
                rate: 5,
                burst: 5
            });
        }
    }

    output(`SNS subscriptions`);
    await deleteAWSResource(
        "SNS subscription(s)",
        /(:faast-)|(:cloudify-)/,
        () => sns.listSubscriptions(),
        page => page.Subscriptions,
        subscription => subscription.SubscriptionArn,
        SubscriptionArn => sns.unsubscribe({ SubscriptionArn }).promise()
    );

    output(`SNS topics`);
    await deleteAWSResource(
        "SNS topic(s)",
        /(:faast-)|(:cloudify-)/,
        () => sns.listTopics(),
        page => page.Topics,
        topic => topic.TopicArn,
        TopicArn => sns.deleteTopic({ TopicArn }).promise()
    );

    output(`SQS queues`);
    await deleteAWSResource(
        "SQS queue(s)",
        /(\/faast-)|(\/cloudify-)/,
        () => sqs.listQueues(),
        page => page.QueueUrls,
        queueUrl => queueUrl,
        QueueUrl => sqs.deleteQueue({ QueueUrl }).promise()
    );

    output(`Lambda functions`);
    await deleteAWSResource(
        "Lambda function(s)",
        /^(faast-)|(cloudify-)/,
        () => lambda.listFunctions(),
        page => page.Functions,
        func => func.FunctionName,
        FunctionName => lambda.deleteFunction({ FunctionName }).promise()
    );

    output(`IAM roles`);
    await deleteAWSResource(
        "IAM role(s)",
        cleanAll ? /^(faast-)|(cloudify-)/ : /^(faast-)|(cloudify-)(?!cached)/,
        () => iam.listRoles(),
        page => page.Roles,
        role => role.RoleName,
        RoleName => awsFaast.deleteRole(RoleName, iam)
    );

    output(`S3 bucket keys`);
    const buckets = await listAWSResource(
        /^(faast-)|(cloudify-)/,
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
        /^(faast-)|(cloudify-)/,
        () => s3.listBuckets(),
        page => page.Buckets,
        bucket => bucket.Name,
        Bucket => s3.deleteBucket({ Bucket }).promise()
    );

    const cache = await LocalCache.create(".faast/aws");
    output(`Local cache: ${cache.dir}`);
    const entries = await cache.entries();
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
        /(\/faast-)|(\/cloudify-)/,
        () => cloudwatch.describeLogGroups(),
        page => page.logGroups,
        logGroup => logGroup.logGroupName,
        logGroupName => cloudwatch.deleteLogGroup({ logGroupName }).promise()
    );

    return nResources;
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

async function cleanupGoogle({ execute }: CleanupOptions) {
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
                concurrency: 20,
                rate: 20,
                burst: 20
            });
        }
    }
    const { cloudFunctions, pubsub } = await googleFaast.initializeGoogleServices();
    const project = await google.auth.getProjectId();
    log(`Default project: ${project}`);

    output(`Cloud functions`);
    await deleteGoogleResource(
        "Cloud Function(s)",
        /faast-/,
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
        /faast-/,
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
        /topics\/faast-/,
        pageToken =>
            pubsub.projects.topics.list({ pageToken, project: `projects/${project}` }),
        page => page.topics,
        topic => topic.name,
        topicName => pubsub.projects.topics.delete({ topic: topicName })
    );

    return nResources;
}

async function cleanupLocal({ execute }: CleanupOptions) {
    const output = (msg: string) => !execute && log(msg);
    const tmpDir = tmpdir();
    const dir = await readdir(tmpDir);
    let nResources = 0;
    output(`Temporary directories:`);
    for (const entry of dir) {
        if (entry.match(/^faast-[a-f0-9-]+/)) {
            nResources++;
            const faastDir = path.join(tmpDir, entry);
            output(`${faastDir}`);
            if (execute) {
                await rmrf(faastDir);
            }
        }
    }
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

async function runCleanup(cloud: string, options: CleanupOptions) {
    let nResources = 0;
    if (cloud === "aws") {
        nResources = await cleanupAWS(options);
    } else if (cloud === "google") {
        nResources = await cleanupGoogle(options);
    } else if (cloud === "local") {
        nResources = await cleanupLocal(options);
    } else {
        warn(
            `Unknown cloud name ${
                commander.cloud
            }. Must specify "aws" or "google", or "local".`
        );
        process.exit(-1);
    }
    if (options.execute) {
        log(`Done.`);
    } else {
        if (nResources === 0) {
            log(`No resources to clean up.`);
        }
    }
    return nResources;
}

async function main() {
    let cloud!: string;
    commander
        .version("0.1.0")
        .option("-v, --verbose", "Verbose mode")
        .option(
            "-a, --all",
            `(AWS only) Removes the IAM 'faast-cached-*' roles, which are used to speed startup.`
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
            `Cleanup faast resources that may have leaked. The <cloud> argument must be "aws", "google", or "local".
  By default the output is a dry run and will only print the actions that would be performed if '-x' is specified.`
        );

    commander.parse(process.argv);
    if (commander.verbose) {
        process.env.DEBUG = "faast:*";
    }
    const execute = commander.execute || false;
    let region = commander.region;

    if (!region) {
        switch (cloud) {
            case "aws":
                region = awsFaast.defaults.region;
                break;
            case "google":
                region = googleFaast.defaults.region;
                break;
        }
    }
    const force = commander.force || false;
    const cleanAll = commander.all || false;

    region && log(`Region: ${region}`);
    const options = { region, execute, cleanAll };
    let nResources = 0;
    if (execute && !force) {
        nResources = await runCleanup(cloud, { ...options, execute: false });
        if (nResources > 0) {
            await prompt();
        } else {
            process.exit(0);
        }
    }
    nResources = await runCleanup(cloud, options);

    if (!execute && nResources > 0) {
        log(`(dryrun mode, no resources will be deleted, specify -x to execute cleanup)`);
    }
}

main();
