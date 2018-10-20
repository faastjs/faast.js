import * as aws from "aws-sdk";
import * as tar from "tar-stream";
import * as stream from "stream";
import * as util from "util";

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
    await new Promise(resolve => tarExtract.on("finish", resolve));
}

let start = Date.now();

function timestamp() {
    return `${(Date.now() - start) / 1000}s`;
}

function log(msg: string) {
    console.log(`${timestamp()} ${msg}`);
}

export async function processBucketObject(Bucket: string, Key: string) {
    start = Date.now();
    log(`ProcessBucketObject called: Bucket: ${Bucket}, Key: ${Key}`);

    log(`Starting download`);
    const result = await s3.getObject({ Bucket, Key }).promise();
    log(`Download finished`);
    log(`Result: ${util.inspect(result)}`);
    if (result.ContentType === "application/x-directory") {
        log(`Directory entry. Skipping.`);
        return { nExtracted: 0, nErrors: 0 };
    }
    let nExtracted = 0;
    let nErrors = 0;
    const promises: Promise<void>[] = [];
    await extractTarBuffer(result.Body! as Buffer, async (header, tarstream) => {
        if (header.type === "file") {
            // log(`Uploading ${header.name}, size: ${header.size}`);
            promises.push(
                s3
                    .putObject({
                        Bucket: "arxiv-derivative-output",
                        Key: header.name,
                        Body: tarstream,
                        ContentLength: header.size
                    })
                    .promise()
                    .then(_ => {
                        // log(`Uploaded ${header.name}`);
                        nExtracted++;
                    })
                    .catch(err => {
                        log(err);
                        nErrors++;
                        log(
                            `Error uploading extracted/${header.name}, size: ${
                                header.size
                            }`
                        );
                    })
            );
        }
    });
    await Promise.all(promises);
    log(`Extracted ${nExtracted} files from ${Bucket}, ${Key}`);
    log(`Errors uploading: ${nErrors}`);
    return { nExtracted, nErrors };
}
