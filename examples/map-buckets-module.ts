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

// Error processing pdf/arXiv_pdf_1609_008.tar
// Logs: https://us-west-2.console.aws.amazon.com/cloudwatch/home?region=us-west-2#logEventViewer:group=%2Faws%2Flambda%2Fcloudify-a0c47fc1-694b-4810-9b78-e36582ac56c9;stream=2018%2F10%2F23%2F%5B%24LATEST%5D93b0e7bbb9f3466dbcaa6a74d2cd6bca;filter=%22ea77ed84-d700-11e8-9643-25010a31b2e7%22

export async function processBucketObject(Bucket: string, Key: string) {
    start = Date.now();
    log(`ProcessBucketObject called: Bucket: ${Bucket}, Key: ${Key}`);
    if (!Key.endsWith(".tar")) {
        log(`Skipping ${Key}`);
        return { nExtracted: 0, nErrors: 0 };
    }

    log(`Starting download`);
    const result = await s3.getObject({ Bucket, Key }).promise();
    log(`Download finished`);
    log(`Result: ${util.inspect(result)}`);
    let nExtracted = 0;
    let nErrors = 0;
    await extractTarBuffer(result.Body! as Buffer, async (header, tarstream) => {
        if (header.type === "file") {
            nExtracted++;
            // log(`Entry ${header.name}, size: ${header.size}`);
            // promises.push(
            //     s3
            //         .putObject({
            //             Bucket: "arxiv-derivative-output",
            //             Key: header.name,
            //             Body: tarstream,
            //             ContentLength: header.size
            //         })
            //         .promise()
            //         .then(_ => {
            //             // log(`Uploaded ${header.name}`);
            //             nExtracted++;
            //         })
            //         .catch(err => {
            //             log(err);
            //             nErrors++;
            //             log(`Error uploading ${header.name}, size: ${header.size}`);
            //         })
            // );
        }

        await new Promise(resolve => {
            tarstream.on("end", resolve);
            tarstream.resume();
        });
    });
    log(`Extracted ${nExtracted} files from ${Bucket}, ${Key}`);
    log(`Errors uploading: ${nErrors}`);
    return { nExtracted, nErrors };
}

export async function moveObject(
    fromBucket: string,
    fromKey: string,
    toBucket: string,
    toKey: string
) {
    const obj = await s3.getObject({ Bucket: fromBucket, Key: fromKey }).promise();
    await s3.putObject({ Bucket: toBucket, Key: toKey, Body: obj.Body }).promise();
}
