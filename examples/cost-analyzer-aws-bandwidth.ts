import * as commander from "commander";
import { costAnalyzer, Promisified } from "../src/faast";
import { f1, GB, Statistics, f2, MB, assertNever } from "../src/shared";
import * as m from "./map-buckets-module";
import { listAllObjects } from "./util";
import { toCSV } from "../src/cost";

type FilterFn = (s: string) => boolean;

interface Metrics {
    bytes: number;
    bandwidth: number;
    aggregateBandwidthMbps: number;
}

const workload = (Bucket: string, filter: FilterFn) => async (
    remote: Promisified<typeof m>
) => {
    let allObjects = await listAllObjects(Bucket);
    allObjects = allObjects.filter(obj => filter(obj.Key!));
    const promises = [];
    const start = Date.now();
    for (const Obj of allObjects) {
        promises.push(remote.processBucketObject(Bucket, Obj.Key!));
    }
    const elapsed = Date.now() - start;
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
    const metrics: Metrics = {
        bytes,
        bandwidth: bandwidth.mean,
        aggregateBandwidthMbps: ((bytes * 8) / MB / elapsed) * allObjects.length
    };
    return metrics;
};

function format(key: keyof Metrics, value: number) {
    if (value === undefined) {
        return "N/A";
    }
    if (key === "bytes") {
        return `${f2(value / GB)}GB`;
    } else if (key === "bandwidth") {
        return `${f1(value)}Mbps`;
    } else if (key === "aggregateBandwidthMbps") {
        return `${f1(value)}Mbps`;
    }
    return assertNever(key);
}

async function compareAws(Bucket: string, filter: FilterFn) {
    const result = await costAnalyzer.estimateWorkloadCost(
        require.resolve("./map-buckets-module"),
        costAnalyzer.awsConfigurations
            .filter(c =>
                [256, 512, 640, 1024, 1728, 2048, 3008].find(
                    m => m === c.options.memorySize
                )
            )
            .map(c => ({ ...c, repetitions: 10, repetitionConcurrency: 10 })),
        {
            work: workload(Bucket, filter),
            format
        },
        { concurrent: 1 }
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
