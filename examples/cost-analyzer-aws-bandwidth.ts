import * as commander from "commander";
import { costAnalyzer, Promisified } from "../src/faast";
import { f1, GB, Statistics } from "../src/shared";
import * as m from "./map-buckets-module";
import { listAllObjects } from "./util";

type FilterFn = (s: string) => boolean;

const workload = (Bucket: string, filter: FilterFn) => async (
    remote: Promisified<typeof m>
) => {
    let allObjects = await listAllObjects(Bucket);
    allObjects = allObjects.filter(obj => filter(obj.Key!));
    const promises = [];
    for (const Obj of allObjects) {
        promises.push(remote.processBucketObject(Bucket, Obj.Key!));
        break;
    }
    const results = await Promise.all(promises);
    let bytes = 0;
    let bandwidth = new Statistics();
    for (const result of results) {
        if (!result) {
            continue;
        }
        bytes += result.bytes;
        bandwidth.update(result.bandwidthMbps);
    }
    return `${f1(bytes / GB)}GB, ${bandwidth}Mbps`;
};

async function compareAws(Bucket: string, filter: FilterFn) {
    costAnalyzer.estimateWorkloadCost(
        require.resolve("./map-buckets-module"),
        workload(Bucket, filter),
        costAnalyzer.awsConfigurations
            .filter(c =>
                [128, 256, 512, 640, 1024, 1728, 2048, 3008].find(
                    m => m === c.options.memorySize
                )
            )
            .map(c => ({ ...c, repetitions: 10, repetitionConcurrency: 10 })),
        { concurrent: 8 }
    );
}

async function main() {
    let bucket!: string;
    commander
        .version("0.1.0")
        .option("-v, --verbose", "verbose mode")
        .arguments("<bucket>")
        .action(arg => {
            bucket = arg;
        })
        .description(
            `Map over all keys in a given S3 bucket. E.g. arxiv-derivative-flattened`
        );

    commander.parse(process.argv);
    if (commander.verbose) {
        process.env.DEBUG = "faast:*";
    }

    if (bucket) {
        compareAws(bucket, key => key.match(/arXiv_pdf_.*\.tar$/) !== null);
    }
}

main();
