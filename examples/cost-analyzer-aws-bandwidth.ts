import * as commander from "commander";
import { costAnalyzer, Promisified } from "../src/faast";
import { f1, GB, Statistics, f2 } from "../src/shared";
import * as m from "./map-buckets-module";
import { listAllObjects } from "./util";
import { toCSV, WorkloadMetrics } from "../src/cost";

type FilterFn = (s: string) => boolean;

interface WorkloadSummary extends WorkloadMetrics {
    bytes: number;
    bandwidth: number;
}

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
    return { bytes, bandwidth: bandwidth.mean };
};

function format(key: keyof WorkloadSummary, value: number) {
    if (value === undefined) {
        return "N/A";
    }
    if (key === "bytes") {
        return `${f2(value / GB)}GB`;
    } else if (key === "bandwidth") {
        return `${f1(value)}Mbps`;
    } else {
        return "";
    }
}

async function compareAws(Bucket: string, filter: FilterFn) {
    const result = await costAnalyzer.estimateWorkloadCost(
        require.resolve("./map-buckets-module"),
        costAnalyzer.awsConfigurations
            .filter(c =>
                [128, 256, 512, 640, 1024, 1728, 2048, 3008].find(
                    m => m === c.options.memorySize
                )
            )
            .map(c => ({ ...c, repetitions: 1, repetitionConcurrency: 1 })),
        {
            work: workload(Bucket, filter),
            format
        },
        { concurrent: 8 }
    );
    console.log(`${toCSV(result, format)}`);
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
