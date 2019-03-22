import * as commander from "commander";
import { CostAnalyzer, Statistics, FaastModule } from "../index";
import * as m from "./map-buckets-module";
import { listAllObjects, f1, GB, f2 } from "./util";
import { writeFile as fsWriteFile } from "fs";
import { promisify } from "util";

const writeFile = promisify(fsWriteFile);

type FilterFn = (s: string) => boolean;

interface BandwidthMetrics {
    bytesGB: number;
    bandwidthMbps: number;
}

const workload = (Bucket: string, filter: FilterFn) => async (
    faastModule: FaastModule<typeof m>
) => {
    const remote = faastModule.functions;
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
    const metrics: BandwidthMetrics = {
        bytesGB: bytes / GB,
        bandwidthMbps: bandwidth.mean
    };
    return metrics;
};

function format(key: keyof BandwidthMetrics, value: number) {
    if (value === undefined) {
        return "N/A";
    }
    if (key === "bytesGB") {
        return `${f2(value)}GB`;
    } else if (key === "bandwidthMbps") {
        return `${f1(value)}Mbps`;
    } else if (key === "aggregateBandwidthMbps") {
        return `${f1(value)}Mbps-effective`;
    }
    throw new Error(`Bad key in format: '${key}'`);
}

function formatCSV(key: keyof BandwidthMetrics, value: number) {
    if (value === undefined) {
        return "N/A";
    }
    if (key === "bytesGB") {
        return f2(value);
    } else if (key === "bandwidthMbps") {
        return f1(value);
    } else if (key === "aggregateBandwidthMbps") {
        return f1(value);
    }
    throw new Error(`Bad key in format: '${key}'`);
}

async function compareAws(Bucket: string, filter: FilterFn) {
    const result = await CostAnalyzer.analyze(
        m,
        require.resolve("./map-buckets-module"),
        {
            work: workload(Bucket, filter),
            format,
            formatCSV,
            repetitions: 5,
            concurrency: 5
        }
    );
    writeFile("cost.csv", result.csv());
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
