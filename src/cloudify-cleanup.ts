require("source-map-support").install();

import * as commander from "commander";
import * as awsCloudify from "./aws/aws-cloudify";
import * as googleCloudify from "./google/google-cloudify";
import * as aws from "aws-sdk";
import * as inquirer from "inquirer";

const warn = console.warn;
const log = console.log;

async function cleanupAWS(region: string, execute: boolean, cleanAll: boolean) {
    const { cloudwatch, iam, lambda, sns, sqs } = awsCloudify.createAWSApis(region);
    log(`Cleaning up AWS resources`);
    async function deleteAWSResource<T, U>(
        pattern: RegExp,
        getList: () => aws.Request<T, aws.AWSError>,
        extractList: (arg: T) => U[] | undefined,
        extractElement: (arg: U) => string | undefined,
        remove: (arg: string) => Promise<any>
    ) {
        let allResources: string[] = [];
        await new Promise((resolve, reject) => {
            getList().eachPage((err, page) => {
                if (err) reject(err);
                const elems = (page && extractList(page)) || [];
                allResources.push(...elems.map(elem => extractElement(elem) || ""));
                if (page === null) {
                    resolve(allResources);
                }
                return true;
            });
        });
        const matchingResources = allResources.filter(t => t.match(pattern));
        matchingResources.forEach(resource => log(`  ${resource}`));
        if (execute) {
            await Promise.all(matchingResources.map(remove));
        }
    }

    log(`SNS subscriptions`);
    await deleteAWSResource(
        /:cloudify-/,
        () => sns.listSubscriptions(),
        page => page.Subscriptions,
        subscription => subscription.SubscriptionArn,
        SubscriptionArn => sns.unsubscribe({ SubscriptionArn }).promise()
    );

    log(`SNS topics`);
    await deleteAWSResource(
        /:cloudify-/,
        () => sns.listTopics(),
        page => page.Topics,
        topic => topic.TopicArn,
        TopicArn => sns.deleteTopic({ TopicArn }).promise()
    );

    log(`SQS queues`);
    await deleteAWSResource(
        /\/cloudify-/,
        () => sqs.listQueues(),
        page => page.QueueUrls,
        queueUrl => queueUrl,
        QueueUrl => sqs.deleteQueue({ QueueUrl }).promise()
    );

    log(`Lambda functions`);
    await deleteAWSResource(
        /^cloudify-/,
        () => lambda.listFunctions(),
        page => page.Functions,
        func => func.FunctionName,
        FunctionName => lambda.deleteFunction({ FunctionName }).promise()
    );

    log(`Cloudwatch log groups`);
    await deleteAWSResource(
        /^\/aws\/lambda\/cloudify-/,
        () =>
            cloudwatch.describeLogGroups({ logGroupNamePrefix: "/aws/lambda/cloudify-" }),
        page => page.logGroups,
        logGroup => logGroup.logGroupName,
        logGroupName => cloudwatch.deleteLogGroup({ logGroupName }).promise()
    );

    log(`IAM roles`);
    await deleteAWSResource(
        cleanAll ? /^cloudify-/ : /^cloudify-(?!cached)/,
        () => iam.listRoles(),
        page => page.Roles,
        role => role.RoleName,
        RoleName => awsCloudify.deleteRole(RoleName, iam)
    );
}

async function main() {
    let cloud!: string;
    commander
        .version("0.1.0")
        .option("-v, --verbose", "Verbose mode")
        .option(
            "-a, --all",
            `Removes the IAM role 'cloudify-cached-role', which is used to speed cloudify startup.`
        )
        .option(
            "-x, --execute",
            "Execute the cleanup process. If this option is not specified, the output will be a dry run."
        )
        .option("-f, --force", "When used with -x, skips the prompt")
        .option(
            "-r, --region <region>",
            "Region to clean up. Defaults to us-west-1 for AWS, and us-central1 for Google."
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
        process.env["DEBUG"] = "cloudify:*";
    }
    let execute = commander.execute || false;
    const region = commander.region || awsCloudify.defaults.region;
    const force = commander.force || false;
    const cleanAll = commander.all || false;

    if (execute) {
        if (!force) {
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
    } else {
        log(`=== Dry run mode ===`);
        log(`No resources will be deleted. Specify -x to execute cleanup.`);
    }
    if (cloud === "aws") {
        cleanupAWS(region, execute, cleanAll);
        return;
    }
    warn(`Unknown cloud name ${commander.cloud}. Must specify "aws" or "google"`);
    process.exit(-1);
}

main();
