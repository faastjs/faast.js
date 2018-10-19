import * as aws from "aws-sdk";
import * as tar from "tar-stream";
import * as stream from "stream";

const s3 = new aws.S3({ region: "us-west-2" });

export async function extractTarBuffer(
    content: Buffer,
    processEntry: (header: tar.Headers, tarstream: stream.Readable) => Promise<void>
) {
    const tarExtract: tar.Extract = tar.extract();
    tarExtract.on("entry", async (header, tarstream, next) => {
        await processEntry(header, tarstream);
        next();
    });
    const readable = new stream.Readable();
    readable._read = () => {};
    readable.push(content);
    readable.push(null);
    readable.pipe(tarExtract);
    await new Promise(resolve => readable.on("end", resolve));
}

export async function processBucketObject(Bucket: string, Key: string) {
    const start = Date.now();
    console.log(`ProcessBucketObject called: Bucket: ${Bucket}, Key: ${Key}`);

    console.log(`${Date.now() - start} Starting download`);
    const result = await s3.getObject({ Bucket, Key }).promise();
    console.log(`${Date.now() - start} Download finished`);
    console.log(`Result: %O`, result);
    if (result.ContentType === "application/x-directory") {
        console.log(`Directory entry. Skipping.`);
        return;
    }
    extractTarBuffer(result.Body! as Buffer, async (header, tarstream) => {
        if (header.type === "file") {
            console.log(
                `${Date.now() - start}s Uploading ${header.name}, size: ${header.size}`
            );
            s3.putObject({
                Bucket: "arxiv-derivative",
                Key: `extracted/${header.name}`,
                Body: tarstream,
                ContentLength: header.size
            })
                .promise()
                .then(_ => {
                    console.log(
                        `${(Date.now() - start) / 1000}s Uploaded ${header.name}`
                    );
                });
        }
    });
}
