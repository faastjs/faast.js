import { cloudify } from "../src/cloudify";
import * as m from "./map-buckets-module";
import * as aws from "aws-sdk";

const s3 = new aws.S3();

export async function mapBucket(Bucket: string) {
    const { cloudFunc, remote } = await cloudify("aws", m, "./module");
    try {
        const objects = await s3.listObjectsV2({ Bucket }).promise();
        console.log(`Bucket ${Bucket} contains ${objects.Contents!.length} objects`);
        await remote.processBucketObject(Bucket, objects.Contents![0].Key!);
    } finally {
        const cost = await cloudFunc.costEstimate();
        console.log(`${cost}`);
        await cloudFunc.stop();
    }
}

mapBucket("arxiv-derivative");
