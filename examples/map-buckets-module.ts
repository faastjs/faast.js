import * as aws from "aws-sdk";
import * as tar from "tar-stream";
import { Readable } from "stream";
import { escape } from "querystring";
import { RateLimitedFunnel } from "../src/funnel";
import { createHash } from "crypto";

const s3 = new aws.S3({ region: "us-west-2" });

function streamToBuffer(strm: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const buffers: Buffer[] = [];
        strm.on("error", reject);
        strm.on("data", data => buffers.push(data));
        strm.on("end", () => resolve(Buffer.concat(buffers)));
    });
}

export async function extractTarStream(
    content: Readable,
    processEntry: (header: tar.Headers, buf: Buffer) => void
) {
    const tarExtract: tar.Extract = tar.extract();
    tarExtract.on("entry", async (header, tarstream, next) => {
        const buf = await streamToBuffer(tarstream);
        processEntry(header, buf);
        next();
    });
    content.pipe(tarExtract);
    await new Promise(resolve => tarExtract.on("finish", resolve));
}

let start = Date.now();

function timestamp() {
    return `${(Date.now() - start) / 1000}s`;
}

function log(msg: string) {
    console.log(`${timestamp()} ${msg}`);
}

// Error processing pdf/arXiv_pdf_1609_008.tar
// Logs: https://us-west-2.console.aws.amazon.com/cloudwatch/home?region=us-west-2#logEventViewer:group=%2Faws%2Flambda%2Fcloudify-a0c47fc1-694b-4810-9b78-e36582ac56c9;stream=2018%2F10%2F23%2F%5B%24LATEST%5D93b0e7bbb9f3466dbcaa6a74d2cd6bca;filter=%22ea77ed84-d700-11e8-9643-25010a31b2e7%22

export async function processBucketObject(Bucket: string, Key: string) {
    start = Date.now();
    log(`ProcessBucketObject called: Bucket: ${Bucket}, Key: ${Key}`);
    if (!Key.endsWith(".tar")) {
        log(`Skipping ${Key}`);
        return { nExtracted: 0, nErrors: 0, Key };
    }

    log(`Starting download`);
    const result = await s3.getObject({ Bucket, Key }).createReadStream();

    log(`Extracting tar file stream`);
    let nExtracted = 0;
    let nErrors = 0;
    const funnel = new RateLimitedFunnel({
        maxConcurrency: 10,
        targetRequestsPerSecond: 200
    });

    const retries = 2;
    await extractTarStream(result, (header, buf) => {
        if (header.type === "file") {
            nExtracted++;
            // log(`Entry ${header.name}, size: ${header.size}, buf: ${buf.length}`);

            const prefix = createHash("md5")
                .update(header.name)
                .digest("hex")
                .slice(0, 4);
            const OutputKey = `${prefix}/${header.name}`;

            nExtracted++;
            if (header.size !== buf.length) {
                nErrors++;
            }

            /*
            funnel
                .pushRetry(retries, async () => {
                    return s3
                        .upload({
                            Bucket: "arxiv-derivative-output",
                            Key: OutputKey,
                            Body: buf
                        })
                        .promise()
                        .then(_ => {
                            // log(`Uploaded ${header.name}`);
                            nExtracted++;
                        })
                        .catch(err => {
                            log(err);
                            log(`Retrying ${OutputKey}, size: ${header.size}`);
                            throw err;
                        });
                })
                .catch(_ => {
                    nErrors++;
                    log(
                        `Error uploading ${OutputKey}, size: ${
                            header.size
                        }, failed after ${retries} retries`
                    );
                });
                */
        }
    });

    log(`Promises size: ${funnel.promises().length}`);
    await funnel.all();

    log(`Extracted ${nExtracted} files from ${Bucket}, ${Key}`);
    log(`Errors uploading: ${nErrors}`);
    return { nExtracted, nErrors, Key };
}

export async function copyObject(
    fromBucket: string,
    fromKey: string,
    toBucket: string,
    toKey: string
) {
    await s3
        .copyObject({
            Bucket: toBucket,
            Key: toKey,
            CopySource: escape(fromBucket + "/" + fromKey)
        })
        .promise();
}

export async function deleteObjects(Bucket: string, Keys: string[]) {
    await s3
        .deleteObjects({
            Bucket,
            Delete: {
                Objects: Keys.map(Key => ({
                    Key
                }))
            }
        })
        .promise();
}
