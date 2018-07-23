import * as archiver from "archiver";
import { S3 } from "aws-sdk";
import * as sys from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as JSZip from "jszip";
import * as path from "path";
import * as stream from "stream";

// Make tsc ok with JSZip declarations.
declare global {
    interface Blob {}
}

export function exec(cmds: string[]) {
    let rv = "";
    for (const cmd of cmds) {
        rv += sys.execSync(cmd).toString();
    }
    console.log(rv);
    return rv;
}

const buildDir = "/tmp/build";
const s3 = new S3();

function streamToBuffer(s: stream.Readable) {
    return new Promise<Buffer>((resolve, reject) => {
        const buffers: Buffer[] = [];
        s.on("error", reject);
        s.on("data", (data: Buffer) => buffers.push(data));
        s.on("end", () => resolve(Buffer.concat(buffers)));
    });
}

export interface NpmInstallArgs {
    packageJsonContents: string;
    indexContents: string;
    Bucket: string;
    Key: string;
    caching?: boolean;
}

export async function npmInstall({ Bucket, Key, ...args }: NpmInstallArgs) {
    console.log(
        `*** This cloudify invocation is an internal lambda call used when the packageJson option is specified to createFunction(). ***`
    );
    console.log(
        `*** Its purpose is to create a node_modules package and cache it, then combine with user code to form an AWS Lambda code package and upload it to S3 ***`
    );
    fs.mkdirSync(buildDir);
    fs.writeFileSync(path.join(buildDir, "package.json"), args.packageJsonContents);

    let rv = "";
    console.log("Checking cache");
    if (args.caching) {
        const hasher = createHash("sha256");
        hasher.update(args.packageJsonContents);
        const hash = hasher.digest("hex");
        const cacheKey = `npm-cache-${hash}`;

        console.log(`Checking cloudify cache S3 bucket: ${Bucket}, key: ${cacheKey}`);

        const cached = await s3
            .getObject({ Bucket, Key: cacheKey })
            .promise()
            .catch(_ => {});

        let zipData = cached && cached.Body;
        let cacheUploadPromise: Promise<any> = Promise.resolve();

        if (!zipData) {
            console.log("NOT CACHED, running npm install");
            rv += exec([`export HOME=/tmp && npm install --prefix=${buildDir}`]);
            console.log(`Running archiver`);
            const cacheArchive = archiver("zip", { zlib: { level: 8 } });
            cacheArchive.directory(buildDir, false).finalize();
            console.log(`Uploading to cache, Bucket: ${Bucket}, Key: ${cacheKey}`);
            zipData = await streamToBuffer(cacheArchive);
            cacheUploadPromise = s3
                .upload({ Bucket, Key: cacheKey, Body: zipData })
                .promise();
        }

        console.log("Reading cached zip file");
        let zip = new JSZip();
        zip = await zip.loadAsync(zipData);
        console.log(`Adding index.js to zip file`);
        zip.file("index.js", args.indexContents);
        console.log(`Uploading zip file to Bucket: ${Bucket}, Key: ${Key}`);
        const packageUploadPromise = s3
            .upload({
                Bucket,
                Key,
                Body: zip.generateNodeStream({
                    compression: "DEFLATE",
                    compressionOptions: { level: 8 }
                })
            })
            .promise();
        await Promise.all([cacheUploadPromise, packageUploadPromise]);
    } else {
        console.log(`No caching; running npm install`);
        rv += exec([`export HOME=/tmp && npm install --prefix=${buildDir}`]);
        console.log(`Writing index file`);
        fs.writeFileSync(path.join(buildDir, "index.js"), args.indexContents);
        console.log(`Archiving zip file`);

        const archive = archiver("zip", { zlib: { level: 8 } });
        archive.directory(buildDir, false).finalize();

        console.log(`Uploading zip file`);
        await s3.upload({ Bucket, Key, Body: archive }).promise();
    }
    console.log(`DONE`);

    return rv;
}
