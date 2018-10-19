import { cloudify } from "../src/cloudify";
import * as m from "./map-buckets-module";
import * as aws from "aws-sdk";
import * as fs from "fs";

const s3 = new aws.S3();

export async function mapBucket(Bucket: string) {
    const { cloudFunc, remote } = await cloudify("aws", m, "./map-buckets-module", {
        memorySize: 2048,
        timeout: 300
    });
    try {
        const objects = await s3.listObjectsV2({ Bucket }).promise();
        console.log(`Bucket ${Bucket} contains ${objects.Contents!.length} objects`);
        for (const Obj of objects.Contents!) {
            if (Obj.Key!.match(/^pdf\//)) {
                await remote.processBucketObject(Bucket, Obj.Key!);
            }
        }
    } finally {
        const cost = await cloudFunc.costEstimate();
        console.log(`${cost}`);
        await cloudFunc.stop();
    }
}

mapBucket("arxiv-derivative-west");

function localMain() {
    const file = process.argv[2];
    console.log(`Processing tar file ${file}`);
    m.extractTarBuffer(fs.readFileSync(file), async (header, tarstream) => {
        if (header.type === "file") {
            const start = Date.now();
            console.log(`Uploading ${header.name}`);
            await s3
                .putObject({
                    Bucket: "arxiv-derivative",
                    Key: `extracted/${header.name}`,
                    Body: tarstream,
                    ContentLength: header.size
                })
                .promise();
            console.log(`${(Date.now() - start) / 1000}s Uploaded ${header.name}`);
        }
    });
}
