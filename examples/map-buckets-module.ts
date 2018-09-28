import * as aws from "aws-sdk";
import * as tarstream from "tar-stream";
import * as stream from "stream";

const s3 = new aws.S3();

export async function processBucketObject(Bucket: string, Key: string) {
    const result = await s3.getObject({ Bucket, Key }).promise();
    const extract: tarstream.Extract = tarstream.extract();
    const headers: tarstream.Headers[] = [];
    extract.on("entry", (header, _strm, _next) => {
        headers.push(header);
    });
    const readable = new stream.Readable();
    readable.push(result.Body!);
    readable.push(null);
    readable.pipe(extract);
}
