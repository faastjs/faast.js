import * as commander from "commander";
import { FaastError, faast, Statistics } from "faastjs";
import * as m from "./map-buckets-module";
import { listAllObjects, f1, GB } from "./util";

// https mode:
// Extracted 1223514 files with 8 errors
// functionCallDuration  $0.00004896/second        30015.6 seconds    $1.46951669   100.0%  [1]
// functionCallRequests  $0.00000020/request          1800 requests   $0.00036000     0.0%  [2]
// outboundDataTransfer  $0.09000000/GB         0.00082136 GB         $0.00007392     0.0%  [3]
// sqs                   $0.00000040/request             0 request    $0              0.0%  [4]
// sns                   $0.00000050/request             0 request    $0              0.0%  [5]
// ---------------------------------------------------------------------------------------
//                                                                    $1.46995061 (USD)

let verbose = false;

export async function mapBucket(Bucket: string, keyFilter: (key: string) => boolean) {
    const faastModule = await faast("aws", m, {
        memorySize: 2048,
        timeout: 300,
        mode: "queue",
        concurrency: 2000,
        childProcess: true,
        gc: "off"
        // awsLambdaOptions: { TracingConfig: { Mode: "Active" } }
    });
    console.log(`Logs: ${faastModule.logUrl()} `);
    faastModule.on("stats", s => {
        console.log(`${s}`);
    });

    const bandwidth = new Statistics();

    try {
        let allObjects = await listAllObjects(Bucket);
        allObjects = allObjects.filter(obj => keyFilter(obj.Key!));
        const promises = [];
        console.log(`Bucket ${Bucket} contains ${allObjects.length} matching objects`);
        const start = Date.now();
        for (const Obj of allObjects) {
            promises.push(
                faastModule.functions
                    .processBucketObject(Bucket, Obj.Key!)
                    .catch((err: FaastError) => {
                        console.log(`Error processing ${Obj.Key!}`);
                        console.log(`Logs: ${FaastError.info(err).logUrl}`);
                    })
            );
        }
        const results = await Promise.all(promises);
        const elapsed = (Date.now() - start) / 1000;
        let extracted = 0;
        let errors = 0;
        let bytes = 0;
        let id = 0;

        verbose &&
            console.log(
                `id,executionTime,user,system,finalExecutionTime,finalUser,finalSystem`
            );

        for (const result of results) {
            if (!result) {
                errors++;
                continue;
            }
            extracted += result.nExtracted;
            errors += result.nErrors;
            bytes += result.bytes;
            bandwidth.update(result.bandwidthMbps);
            const finalTiming = result.timings.pop();
            const p = (n: number) => (n / 1000).toFixed(0);

            if (verbose) {
                result.timings.forEach(t => {
                    console.log(
                        `${id},${t.time},${p(t.usage.user)},${p(t.usage.system)},${p(
                            finalTiming!.time
                        )},${p(finalTiming!.usage.user)},${p(finalTiming!.usage.system)}`
                    );
                });
            }
            id++;
            if (result.nErrors > 0) {
                console.log(`Error uploading key: ${result.Key}`);
            }
        }
        console.log(
            `Extracted ${extracted} files with ${errors} errors, ${f1(bytes / GB)}GB`
        );
        console.log(
            `Bandwidth: ${bandwidth}Mbps, stdev: ${f1(bandwidth.stdev)}, max: ${f1(
                bandwidth.max
            )}, min: ${f1(bandwidth.min)}, samples: ${bandwidth.samples}`
        );
        console.log(
            `Implied bandwidth: ${f1(bytes / GB)}GB * 8 / ${f1(elapsed)}s = ${f1(
                ((bytes / GB) * 8) / elapsed
            )}Gbps aggregate bandwidth implied by end to end completion time`
        );
    } finally {
        const cost = await faastModule.costSnapshot();
        console.log(`${cost}`);
        await faastModule.cleanup();
    }
}

export async function mapObjects(Bucket: string, Keys: string[]) {
    const faastModule = await faast("aws", m, {
        memorySize: 1728,
        timeout: 300,
        mode: "https",
        concurrency: 1
    });
    for (const Key of Keys) {
        await faastModule.functions
            .processBucketObject(Bucket, Key)
            .catch(err => console.error(err));
        console.log(`Processed ${Bucket}/${Key}`);
    }
    await faastModule.cleanup();
}

export async function copyObjects(
    fromBucket: string,
    toBucket: string,
    mapper: (key: string) => string | undefined
) {
    const faastModule = await faast("aws", m, {
        memorySize: 256,
        timeout: 300,
        mode: "queue"
    });

    faastModule.on("stats", console.log);
    const objects = await listAllObjects(fromBucket);
    const promises: Promise<void>[] = [];
    for (const obj of objects) {
        const toKey = mapper(obj.Key!);
        if (toKey) {
            console.log(`Copying ${fromBucket}:${obj.Key} to ${toBucket}:${toKey}`);
            promises.push(
                faastModule.functions
                    .copyObject(fromBucket, obj.Key!, toBucket, toKey)
                    .catch(err => console.error(err))
            );
        } else {
            // console.log(`Skipping ${obj.Key}, no mapping.`);
        }
    }
    await Promise.all(promises);
    await faastModule.cleanup();
}

export async function emptyBucket(Bucket: string) {
    const faastModule = await faast("aws", m, {
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
        promises.push(faastModule.functions.deleteObjects(Bucket, keys));
    }
    await Promise.all(promises);
    await faastModule.cleanup();
}

async function main() {
    let bucket!: string;
    let keys!: string[];
    commander
        .version("0.1.0")
        .option("-v, --verbose", "verbose mode")
        .arguments("<bucket> [keys...]")
        .action((arg, rest) => {
            bucket = arg;
            keys = rest;
        })
        .description(
            `Map over all keys in a given S3 bucket. E.g. arxiv-derivative-flattened`
        );

    const opts = commander.parse(process.argv).opts();
    if (opts.verbose) {
        process.env.DEBUG = "faast:*";
        verbose = true;
    }
    if (keys.length > 0 && keys[0] === "all") {
        mapBucket(bucket, key => key.match(/arXiv_pdf_.*\.tar$/) !== null);
    } else {
        mapObjects(bucket, keys);
    }
}

main();

// if (process.argv[3] === "all") {
//     mapBucket(process.argv[2], key => key.match(/arXiv_pdf_.*\.tar$/) !== null);
// } else {
//     mapObjects(process.argv[2], process.argv.slice(3));
// }

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
