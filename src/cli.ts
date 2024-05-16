#!/usr/bin/env node

require("source-map-support").install();
import { paginateDescribeLogGroups } from "@aws-sdk/client-cloudwatch-logs";
import { paginateListRoles } from "@aws-sdk/client-iam";
import { paginateListFunctions, paginateListLayers } from "@aws-sdk/client-lambda";
import { paginateListSubscriptions, paginateListTopics } from "@aws-sdk/client-sns";
import { paginateListQueues } from "@aws-sdk/client-sqs";
import { paginateListDirectoryBuckets } from "@aws-sdk/client-s3";
import { Paginator } from "@aws-sdk/types";
import { program } from "commander";
import { readdir, remove } from "fs-extra";
import { tmpdir } from "os";
import path from "path";
import * as readline from "readline";
import * as awsFaast from "./aws/aws-faast";
import { PersistentCache, caches } from "./cache";
import { keysOf, uuidv4Pattern } from "./shared";
import { throttle } from "./throttle";

const warn = console.warn;
const log = console.log;

interface CleanupOptions {
    region?: string; // AWS only.
    execute: boolean;
}

async function deleteResources(
    name: string,
    matchingResources: string[],
    doRemove: (arg: string) => Promise<any>,
    { concurrency = 10, rate = 5, burst = 5 } = {}
) {
    const ora = (await import("ora")).default;
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
                retry: 5
            },
            async arg => {
                await doRemove(arg);
                done++;
            }
        );
        const timer = setInterval(
            () => (spinner.text = updateSpinnerText(matchingResources.length - done)),
            1000
        );
        try {
            await Promise.all(
                matchingResources.map(resource =>
                    scheduleRemove(resource).catch(err =>
                        console.warn(`Could not remove resource ${resource}: ${err}`)
                    )
                )
            );
        } finally {
            clearInterval(timer);
            spinner.text = updateSpinnerText();
        }
        spinner.stopAndPersist({ symbol: "✔" });
    }
}

async function cleanupAWS({ region, execute }: CleanupOptions) {
    let nResources = 0;
    const output = (msg: string) => !execute && log(msg);
    const { cloudwatch, iam, lambda, sns, sqs, s3 } = await awsFaast.createAwsApis(
        region! as awsFaast.AwsRegion
    );

    async function listAWSResource<T, U>(
        pattern: RegExp,
        getList: () => Paginator<T>,
        extractList: (arg: T) => U[] | undefined,
        extractElement: (arg: U) => string | undefined
    ) {
        const allResources: string[] = [];
        for await (const page of getList()) {
            const elems = (page && extractList(page)) || [];
            allResources.push(...elems.map(elem => extractElement(elem) || ""));
        }
        const matchingResources = allResources.filter(t => t.match(pattern));
        matchingResources.forEach(resource => output(`  ${resource}`));
        return matchingResources;
    }

    async function deleteAWSResource<T, U>(
        name: string,
        pattern: RegExp,
        getList: () => Paginator<T>,
        extractList: (arg: T) => U[] | undefined,
        extractElement: (arg: U) => string | undefined,
        doRemove: (arg: string) => Promise<any>
    ) {
        const allResources = await listAWSResource(
            pattern,
            getList,
            extractList,
            extractElement
        );
        nResources += allResources.length;
        if (execute) {
            await deleteResources(name, allResources, doRemove, {
                concurrency: 10,
                rate: 5,
                burst: 5
            });
        }
    }

    output(`SNS subscriptions`);
    await deleteAWSResource(
        "SNS subscription(s)",
        new RegExp(`:faast-${uuidv4Pattern}`),
        () => paginateListSubscriptions({ client: sns }, {}),
        page => page.Subscriptions,
        subscription => subscription.SubscriptionArn,
        SubscriptionArn => sns.unsubscribe({ SubscriptionArn })
    );

    output(`SNS topics`);
    await deleteAWSResource(
        "SNS topic(s)",
        new RegExp(`:faast-${uuidv4Pattern}`),
        () => paginateListTopics({ client: sns }, {}),
        page => page.Topics,
        topic => topic.TopicArn,
        TopicArn => sns.deleteTopic({ TopicArn })
    );

    output(`SQS queues`);
    await deleteAWSResource(
        "SQS queue(s)",
        new RegExp(`/faast-${uuidv4Pattern}`),
        () => paginateListQueues({ client: sqs }, {}),
        page => page.QueueUrls,
        queueUrl => queueUrl,
        QueueUrl => sqs.deleteQueue({ QueueUrl })
    );

    output(`S3 buckets`);
    await deleteAWSResource(
        "S3 bucket(s)",
        new RegExp(`^faast-${uuidv4Pattern}`),
        () => paginateListDirectoryBuckets({ client: s3 }, {}),
        page => page.Buckets,
        Bucket => Bucket.Name,
        async Bucket => {
            const objects = await s3.listObjectsV2({ Bucket, Prefix: "faast-" });
            const keys = (objects.Contents || []).map(entry => ({ Key: entry.Key! }));
            if (keys.length > 0) {
                await s3.deleteObjects({ Bucket, Delete: { Objects: keys } });
            }
            await s3.deleteBucket({ Bucket });
        }
    );

    output(`Lambda functions`);
    await deleteAWSResource(
        "Lambda function(s)",
        new RegExp(`^faast-${uuidv4Pattern}`),
        () => paginateListFunctions({ client: lambda }, {}),
        page => page.Functions,
        func => func.FunctionName,
        FunctionName => lambda.deleteFunction({ FunctionName })
    );

    output(`IAM roles`);
    await deleteAWSResource(
        "IAM role(s)",
        /^faast-cached-lambda-role$/,
        () => paginateListRoles({ client: iam }, {}),
        page => page.Roles,
        role => role.RoleName,
        RoleName => awsFaast.deleteRole(RoleName, iam)
    );

    output(`IAM test roles`);
    await deleteAWSResource(
        "IAM test role(s)",
        new RegExp(`^faast-test-.*${uuidv4Pattern}$`),
        () => paginateListRoles({ client: iam }, {}),
        page => page.Roles,
        role => role.RoleName,
        RoleName => awsFaast.deleteRole(RoleName, iam)
    );

    output(`Lambda layers`);

    await deleteAWSResource(
        "Lambda layer(s)",
        new RegExp(`^faast-(${uuidv4Pattern})|([a-f0-9]{64})`),
        () => paginateListLayers({ client: lambda }, { CompatibleRuntime: "nodejs" }),
        page => page.Layers,
        layer => layer.LayerName,
        async LayerName => {
            const versions = await lambda.listLayerVersions({ LayerName });
            for (const layerVersion of versions.LayerVersions || []) {
                await lambda.deleteLayerVersion({
                    LayerName,
                    VersionNumber: layerVersion.Version!
                });
            }
        }
    );

    async function cleanupCacheDir(cache: PersistentCache) {
        output(`Persistent cache: ${cache.dir}`);
        const entries = await cache.entries();
        if (!execute) {
            output(`  cache entries: ${entries.length}`);
        }
        nResources += entries.length;
        if (execute) {
            cache.clear({ leaveEmptyDir: false });
        }
    }

    for (const cache of keysOf(caches)) {
        await cleanupCacheDir(await caches[cache]);
    }

    output(`Cloudwatch log groups`);
    await deleteAWSResource(
        "Cloudwatch log group(s)",
        new RegExp(`/faast-${uuidv4Pattern}$`),
        () => paginateDescribeLogGroups({ client: cloudwatch }, {}),
        page => page.logGroups,
        logGroup => logGroup.logGroupName,
        logGroupName => cloudwatch.deleteLogGroup({ logGroupName })
    );

    return nResources;
}

async function cleanupLocal({ execute }: CleanupOptions) {
    const output = (msg: string) => !execute && log(msg);
    const tmpDir = tmpdir();
    const dir = await readdir(tmpDir);
    let nResources = 0;
    output(`Temporary directories:`);
    const entryRegexp = new RegExp(`^faast-${uuidv4Pattern}$`);
    for (const entry of dir) {
        if (entry.match(entryRegexp)) {
            nResources++;
            const faastDir = path.join(tmpDir, entry);
            output(`${faastDir}`);
            if (execute) {
                await remove(faastDir);
            }
        }
    }
    return nResources;
}

async function prompt() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    await new Promise<void>(resolve => {
        rl.question(
            "WARNING: this operation will delete resources. Confirm? [y/N] ",
            answer => {
                if (answer !== "y") {
                    log(`Execution aborted.`);
                    process.exit(0);
                }
                rl.close();
                resolve();
            }
        );
    });
}

async function runCleanup(cloud: string, options: CleanupOptions) {
    let nResources = 0;
    if (cloud === "aws") {
        nResources = await cleanupAWS(options);
    } else if (cloud === "local") {
        nResources = await cleanupLocal(options);
    } else {
        warn(`Unknown cloud name "${cloud}". Must specify "aws" or "local".`);
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
    let command: string | undefined;
    program
        .version("0.1.0")
        .option("-v, --verbose", "Verbose mode")
        .option(
            "-r, --region <region>",
            "Cloud region to operate on. Defaults to us-west-2 for AWS."
        )
        .option(
            "-x, --execute",
            "Execute the cleanup process. If this option is not specified, the output will be a dry run."
        )
        .option("-f, --force", "When used with -x, skips the prompt")
        .command("cleanup <cloud>")
        .description(
            `Cleanup faast.js resources that may have leaked. The <cloud> argument must be "aws" or "local".
        By default the output is a dry run and will only print the actions that would be performed if '-x' is specified.`
        )
        .action((arg: string) => {
            command = "cleanup";
            cloud = arg;
        });

    const opts = program.parse(process.argv).opts();
    if (opts.verbose) {
        process.env.DEBUG = "faast:*";
    }
    const execute = opts.execute || false;
    let region = opts.region;

    if (!region) {
        switch (cloud) {
            case "aws":
                region = awsFaast.defaults.region;
                break;
        }
    }
    const force = opts.force || false;

    region && log(`Region: ${region}`);
    const options = { region, execute };
    let nResources = 0;
    if (command === "cleanup") {
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
            log(
                `(dryrun mode, no resources will be deleted, specify -x to execute cleanup)`
            );
        }
    } else {
        log(`No command specified.`);
        program.help();
    }
}

main();
