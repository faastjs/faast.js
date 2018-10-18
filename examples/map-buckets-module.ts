import * as aws from "aws-sdk";
import * as tar from "tar-stream";
import * as stream from "stream";

const s3 = new aws.S3();

export async function processBucketObject(Bucket: string, Key: string) {
    const result = await s3.getObject({ Bucket, Key }).promise();
    const extract: tar.Extract = tar.extract();
    extract.on("entry", (header, tarstream, next) => {
        console.log(`Entry: ${header.name}, size: ${header.size}`);
        tarstream.on("end", next);
    });
    const readable = new stream.Readable();
    readable.push(result.Body!);
    readable.push(null);
    readable.pipe(extract);
}
