import * as commander from "commander";
import { costAnalyzer, Promisified } from "../src/faast";
import { f1, GB, Statistics, f2, MB, assertNever } from "../src/shared";
import * as m from "./map-buckets-module";
import { listAllObjects } from "./util";
import { toCSV } from "../src/cost";
import { writeFile } from "../src/fs";

type FilterFn = (s: string) => boolean;

interface Metrics {
    bytesGB: number;
    bandwidthMbps: number;
    // aggregateBandwidthMbps: number;
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
        break;
    }
    const results = await Promise.all(promises);
    const elapsed = Date.now() - start;
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
        bytesGB: bytes / GB,
        bandwidthMbps: bandwidth.mean
        // aggregateBandwidthMbps: ((bytes / MB) * 8) / (elapsed / 1000)
    };
    return metrics;
};

const makeFormatter = ({ csv = false }) => {
    return function format(key: keyof Metrics, value: number) {
        if (value === undefined) {
            return "N/A";
        }
        if (key === "bytesGB") {
            return csv ? f2(value) : `${f2(value)}GB`;
        } else if (key === "bandwidthMbps") {
            return csv ? f1(value) : `${f1(value)}Mbps`;
        } else if (key === "aggregateBandwidthMbps") {
            return csv ? f1(value) : `${f1(value)}Mbps-effective`;
        }
        return assertNever(key);
    };
};

async function compareAws(Bucket: string, filter: FilterFn) {
    const result = await costAnalyzer.estimateWorkloadCost(
        require.resolve("./map-buckets-module"),
        costAnalyzer.awsConfigurations.map(c => ({
            ...c,
            repetitions: 5,
            repetitionConcurrency: 5
        })),
        {
            work: workload(Bucket, filter),
            format: makeFormatter({ csv: false })
        },
        { concurrent: 8 }
    );
    await writeFile("cost.csv", toCSV(result, makeFormatter({ csv: true })));
    // console.log(`${toCSV(result, makeFormatter(true))}`);
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
