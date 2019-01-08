import { costAnalyzer, Promisified } from "../src/faast";
import * as m from "./map-buckets-module";
import { listAllObjects } from "./map-buckets";
import * as commander from "commander";

let verbose = false;

async function workload(remote: Promisified<typeof m>) {
    let allObjects = await listAllObjects(Bucket);
    allObjects = allObjects.filter(obj => keyFilter(obj.Key!));
    const promises = [];
    console.log(`Bucket ${Bucket} contains ${allObjects.length} matching objects`);
    const start = Date.now();
    for (const Obj of allObjects) {
        promises.push(
            cloudFunc.functions
                .processBucketObject(Bucket, Obj.Key!)
                .catch((err: FaastError) => {
                    console.log(`Error processing ${Obj.Key!}`);
                    console.log(`Logs: ${err.logUrl}`);
                })
        );
    }
}

async function compareAws(Bucket: string, filter: (s: string) => boolean) {
    costAnalyzer.estimateWorkloadCost(
        require.resolve("./module"),
        workload,
        costAnalyzer.awsConfigurations
    );
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

    commander.parse(process.argv);
    if (commander.verbose) {
        process.env.DEBUG = "faast:*";
        verbose = true;
    }

    compareAws(bucket, key => key.match(/arXiv_pdf_.*\.tar$/) !== null);
}

main();
