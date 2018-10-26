import { cloudify, CloudifyError } from "../src/cloudify";
import * as m from "./map-buckets-module";
import * as aws from "aws-sdk";
import { createHash } from "crypto";

const s3 = new aws.S3();

// https mode:
// Extracted 1223514 files with 8 errors
// functionCallDuration  $0.00004896/second        30015.6 seconds    $1.46951669   100.0%  [1]
// functionCallRequests  $0.00000020/request          1800 requests   $0.00036000     0.0%  [2]
// outboundDataTransfer  $0.09000000/GB         0.00082136 GB         $0.00007392     0.0%  [3]
// sqs                   $0.00000040/request             0 request    $0              0.0%  [4]
// sns                   $0.00000050/request             0 request    $0              0.0%  [5]
// ---------------------------------------------------------------------------------------
//                                                                    $1.46995061 (USD)

async function listAllObjects(Bucket: string) {
    const allObjects: aws.S3.Object[] = [];
    await new Promise(resolve =>
        s3.listObjectsV2({ Bucket }).eachPage((err, data) => {
            if (err) {
                console.warn(err);
                return false;
            }
            if (data) {
                allObjects.push(...data.Contents!);
            } else {
                resolve();
            }
            return true;
        })
    );
    return allObjects;
}

export async function mapBucket(Bucket: string, keyFilter: (key: string) => boolean) {
    const { cloudFunc, remote } = await cloudify("aws", m, "./map-buckets-module", {
        memorySize: 1728,
        timeout: 300,
        mode: "queue",
        concurrency: 2000
        // awsLambdaOptions: { TracingConfig: { Mode: "Active" } }
    });
    cloudFunc.printStatisticsInterval(1000);
    try {
        let allObjects = await listAllObjects(Bucket);
        allObjects = allObjects.filter(obj => keyFilter(obj.Key!));
        const promises = [];
        console.log(`Bucket ${Bucket} contains ${allObjects.length} matching objects`);
        for (const Obj of allObjects) {
            promises.push(
                remote
                    .processBucketObject(Bucket, Obj.Key!)
                    .catch((err: CloudifyError) => {
                        console.log(`Error processing ${Obj.Key!}`);
                        console.log(`Logs: ${err.logUrl}`);
                        return { nExtracted: 0, nErrors: 1, Key: Obj.Key! };
                    })
            );
        }
        const results = await Promise.all(promises);
        let extracted = 0;
        let errors = 0;
        for (const result of results) {
            extracted += result.nExtracted;
            errors += result.nErrors;
            if (result.nErrors > 0) {
                console.log(`Error uploading key: ${result.Key}`);
            }
        }
        console.log(`Extracted ${extracted} files with ${errors} errors`);
    } finally {
        const cost = await cloudFunc.costEstimate();
        console.log(`${cost}`);
        await cloudFunc.cleanup();
    }
}

export async function mapObjects(Bucket: string, Keys: string[]) {
    const { cloudFunc, remote } = await cloudify("aws", m, "./map-buckets-module", {
        memorySize: 1728,
        timeout: 300,
        mode: "https",
        concurrency: 1
    });
    for (const Key of Keys) {
        await remote.processBucketObject(Bucket, Key).catch(err => console.error(err));
        console.log(`Processed ${Bucket}/${Key}`);
    }
    await cloudFunc.cleanup();
}

export async function copyObjects(
    fromBucket: string,
    toBucket: string,
    mapper: (key: string) => string | undefined
) {
    const { cloudFunc, remote } = await cloudify("aws", m, "./map-buckets-module", {
        memorySize: 256,
        timeout: 300,
        mode: "queue"
    });

    cloudFunc.printStatisticsInterval(1000);

    const objects = await listAllObjects(fromBucket);
    const promises: Promise<void>[] = [];
    for (const obj of objects) {
        const toKey = mapper(obj.Key!);
        if (toKey) {
            console.log(`Copying ${fromBucket}:${obj.Key} to ${toBucket}:${toKey}`);
            promises.push(
                remote
                    .copyObject(fromBucket, obj.Key!, toBucket, toKey)
                    .catch(err => console.error(err))
            );
        } else {
            // console.log(`Skipping ${obj.Key}, no mapping.`);
        }
    }
    await Promise.all(promises);
    await cloudFunc.cleanup();
}

export async function emptyBucket(Bucket: string) {
    const { cloudFunc, remote } = await cloudify("aws", m, "./map-buckets-module", {
        memorySize: 256,
        timeout: 300,
        mode: "https",
        concurrency: 1
    });
    const objects = await listAllObjects(Bucket);
    console.log(`Emptying Bucket ${Bucket} with ${objects.length} keys`);
    const promises: Promise<void>[] = [];
    while (true) {
        const keys = objects.splice(0, 100).map(obj => obj.Key!);
        if (keys.length === 0) {
            break;
        }
        promises.push(remote.deleteObjects(Bucket, keys));
    }
    await Promise.all(promises);
    await cloudFunc.cleanup();
}

if (process.argv[3] === "all") {
    mapBucket(process.argv[2], key => key.match(/arXiv_pdf_.*\.tar$/) !== null);
} else {
    mapObjects(process.argv[2], process.argv.slice(3));
}

// copyObjects("arxiv-derivative-west", "arxiv-derivative-flattened", key => {
//     const match = key.match(/^pdf\/(arXiv_pdf_\d{4}_\d{3}.tar)$/);
//     if (match) {
//         const prefix = createHash("md5")
//             .update(match[1])
//             .digest("hex")
//             .slice(0, 4);
//         return `${prefix}/${match[1]}`;
//     }
//     return undefined;
// });

// emptyBucket("arxiv-derivative-output");
