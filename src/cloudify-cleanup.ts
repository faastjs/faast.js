require("source-map-support").install();

import * as aws from "aws-sdk";
import * as commander from "commander";
import * as inquirer from "inquirer";
import { delay } from "../test/functions";
import * as awsCloudify from "./aws/aws-cloudify";
import { LocalCache } from "./cache";
import { RateLimitedFunnel, retry } from "./funnel";
import * as ora from "ora";

const warn = console.warn;
const log = console.log;

interface CleanupAWSOptions {
    region: string;
    execute: boolean;
    cleanAll: boolean;
    print?: boolean;
}

async function cleanupAWS({ region, execute, cleanAll }: CleanupAWSOptions) {
    let nResources = 0;
    const output = (msg: string) => !execute && log(msg);
    const { cloudwatch, iam, lambda, sns, sqs, s3 } = awsCloudify.createAWSApis(region);

    async function deleteAWSResource<T, U>(
        name: string,
        pattern: RegExp,
        getList: () => aws.Request<T, aws.AWSError>,
        extractList: (arg: T) => U[] | undefined,
        extractElement: (arg: U) => string | undefined,
        remove: (arg: string) => Promise<any>,
        printOutput: boolean = true
    ) {
        const allResources: string[] = [];
        await new Promise((resolve, reject) => {
            getList().eachPage((err, page) => {
                if (err) {
                    reject(err);
                }
                const elems = (page && extractList(page)) || [];
                allResources.push(...elems.map(elem => extractElement(elem) || ""));
                if (page === null) {
                    resolve(allResources);
                }
                return true;
            });
        });
        const matchingResources = allResources.filter(t => t.match(pattern));
        matchingResources.forEach(resource => printOutput && output(`  ${resource}`));
        nResources += matchingResources.length;
        if (execute && matchingResources.length > 0) {
            const timeEstimate =
                matchingResources.length <= 5
                    ? ""
                    : `(est: ${(matchingResources.length / 5).toFixed(1)}s)`;
            const spinner = ora(
                `Deleting ${matchingResources.length} ${name} ${timeEstimate}`
            ).start();
            const funnel = new RateLimitedFunnel({
                maxConcurrency: 10,
                targetRequestsPerSecond: 5,
                maxBurst: 5
            });
            await Promise.all(
                matchingResources.map(resource =>
                    funnel.pushRetry(3, () => remove(resource))
                )
            );
            spinner.stopAndPersist({ symbol: "✔" });
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

    output(`S3 buckets`);
    await deleteAWSResource(
        "S3 Bucket(s)",
        /^cloudify-/,
        () => s3.listBuckets(),
        page => page.Buckets,
        bucket => bucket.Name,
        async Bucket => {
            await retry(3, () =>
                deleteAWSResource(
                    "S3 Bucket Key(s)",
                    /./,
                    () => s3.listObjectsV2({ Bucket }),
                    object => object.Contents,
                    content => content.Key,
                    Key => s3.deleteObject({ Key, Bucket }).promise()
                )
            );
            await s3
                .deleteBucket({ Bucket })
                .promise()
                .catch(err => warn(`Error deleting Bucket: ${Bucket}: ${err.message}`));
        }
    );

    if (execute) {
        await delay(500);
    }

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

async function cleanupGoogle() {}

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
    const region = commander.region || awsCloudify.defaults.region;
    const force = commander.force || false;
    const cleanAll = commander.all || false;

    if (cloud === "aws") {
        log(`Region: ${region}`);
        if (execute && !force) {
            const n = await cleanupAWS({
                region,
                execute: false,
                cleanAll
            });
            if (n === 0) {
                log(`No resources to clean up.`);
                process.exit(0);
            }
            await prompt();
        }
        await cleanupAWS({ region, execute, cleanAll });
        if (execute) {
            log(`Done.`);
        } else {
            log(
                `(dryrun mode, no resources will be deleted, specify -x to execute cleanup)`
            );
        }
        return;
    }
    warn(`Unknown cloud name ${commander.cloud}. Must specify "aws" or "google"`);
    process.exit(-1);
}

main();
