import S3 from "aws-sdk/clients/s3";
import * as tar from "tar-stream";
import { Readable } from "stream";
import { escape } from "querystring";
import { createHash } from "crypto";
import * as process from "process";

const s3 = new S3({ region: "us-west-2" });

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

export async function processBucketObject(Bucket: string, Key: string) {
    start = Date.now();
    const startCpu = process.cpuUsage();
    log(`ProcessBucketObject called: Bucket: ${Bucket}, Key: ${Key}`);
    if (!Key.endsWith(".tar")) {
        log(`Skipping ${Key}`);
        return undefined;
    }

    log(`Starting download`);
    const result = await s3.getObject({ Bucket, Key }).createReadStream();

    log(`Extracting tar file stream`);
    let nExtracted = 0;
    let nErrors = 0;
    let bytes = 0;

    const timings: Array<{ time: number; usage: NodeJS.CpuUsage }> = [];
    const addTiming = () => {
        timings.push({ time: Date.now() - start, usage: process.cpuUsage(startCpu) });
    };
    const perfTimer = setInterval(addTiming, 1000);

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

            bytes += header.size!;

            // const contentsHash = createHash("md5")
            //     .update(buf)
            //     .digest("hex");

            // log(`${header.name} ${contentsHash}`);

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

    clearInterval(perfTimer);

    const elapsed = Date.now() - start;
    const bandwidthMbps = (bytes * 8) / (elapsed / 1000) / 1e6;
    log(`Extracted ${nExtracted} files from ${Bucket}, ${Key}`);
    log(`bytes: ${bytes}, bandwidth: ${bandwidthMbps}Mbps`);
    log(`Errors uploading: ${nErrors}`);
    addTiming();
    return { nExtracted, nErrors, bytes, Key, timings, bandwidthMbps };
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
