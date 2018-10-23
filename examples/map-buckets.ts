import { cloudify, CloudifyError } from "../src/cloudify";
import * as m from "./map-buckets-module";
import * as aws from "aws-sdk";

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

export async function mapBucket(Bucket: string) {
    const { cloudFunc, remote } = await cloudify("aws", m, "./map-buckets-module", {
        memorySize: 3008,
        timeout: 300,
        mode: "https",
        concurrency: 200
    });
    cloudFunc.printStatisticsInterval(1000);
    try {
        const allObjects: aws.S3.Object[] = [];
        const promises = [];
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
        console.log(`Bucket ${Bucket} contains ${allObjects.length} objects`);
        for (const Obj of allObjects) {
            if (Obj.Key!.match(/^pdf\//)) {
                promises.push(
                    remote
                        .processBucketObject(Bucket, Obj.Key!)
                        .catch((err: CloudifyError) => {
                            console.log(`Error processing ${Obj.Key!}`);
                            console.log(`Logs: ${err.logUrl}`);
                            return { nExtracted: 0, nErrors: 1 };
                        })
                );
            }
        }
        const results = await Promise.all(promises);
        let extracted = 0;
        let errors = 0;
        for (const result of results) {
            extracted += result.nExtracted;
            errors += result.nErrors;
        }
        console.log(`Extracted ${extracted} files with ${errors} errors`);
    } finally {
        const cost = await cloudFunc.costEstimate();
        console.log(`${cost}`);
        await cloudFunc.cleanup();
    }
}

export async function mapObject(Bucket: string, Key: string) {
    const { cloudFunc, remote } = await cloudify("aws", m, "./map-buckets-module", {
        memorySize: 3008,
        timeout: 300,
        mode: "https",
        concurrency: 200
    });
    await remote.processBucketObject(Bucket, Key).catch(err => console.error(err));
    await cloudFunc.cleanup();
}

if (process.argv[3] === "all") {
    mapBucket(process.argv[2]);
} else {
    mapObject(process.argv[2], process.argv[3]);
}

// m.processBucketObject("arxiv-derivative-west", "pdf/arXiv_pdf_0305_001.tar");
