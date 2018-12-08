import * as archiver from "archiver";
import { S3 } from "aws-sdk";
import * as sys from "child_process";
import * as JSZip from "jszip";
import { tmpdir } from "os";
import * as path from "path";
import { mkdir, writeFile } from "../fs";
import { streamToBuffer } from "../shared";

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

const buildDir = path.join(tmpdir(), "build");
const s3 = new S3();

export interface NpmInstallArgs {
    packageJsonContents: string;
    indexContents: string;
    Bucket: string;
    Key: string;
    cacheKey?: string;
}

export async function npmInstall({ Bucket, Key, cacheKey, ...args }: NpmInstallArgs) {
    console.log(
        `*** This cloudify invocation is an internal lambda call used when the packageJson option is specified to createFunction(). ***`
    );
    console.log(
        `*** Its purpose is to create a node_modules package and cache it, then combine with user code to form an AWS Lambda code package and upload it to S3 ***`
    );
    await mkdir(buildDir);
    await writeFile(path.join(buildDir, "package.json"), args.packageJsonContents);

    let rv = "";
    console.log("Checking cache");
    if (cacheKey) {
        console.log(`Checking cloudify cache S3 bucket: ${Bucket}, key: ${cacheKey}`);

        const cached = await s3
            .getObject({ Bucket, Key: cacheKey })
            .promise()
            .catch(_ => {});

        let zipData = cached && (cached.Body as Buffer);
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

        console.log(`Adding index.js to package`);
        const zipStream = await addIndexToPackage(zipData, args.indexContents);

        console.log(`Uploading zip file to Bucket: ${Bucket}, Key: ${Key}`);
        const packageUploadPromise = s3
            .upload({
                Bucket,
                Key,
                Body: zipStream
            })
            .promise();
        await Promise.all([cacheUploadPromise, packageUploadPromise]);
    } else {
        console.log(`No caching; running npm install`);
        rv += exec([`export HOME=/tmp && npm install --prefix=${buildDir}`]);
        console.log(`Writing index file`);
        await writeFile(path.join(buildDir, "index.js"), args.indexContents);
        console.log(`Archiving zip file`);

        const archive = archiver("zip", { zlib: { level: 8 } });
        archive.directory(buildDir, false).finalize();

        console.log(`Uploading zip file`);
        await s3.upload({ Bucket, Key, Body: archive }).promise();
    }
    console.log(`DONE`);

    return rv;
}

export async function addIndexToPackage(
    zipData: Buffer,
    indexContents: string | Promise<string>
) {
    let zip = new JSZip();
    zip = await zip.loadAsync(zipData);
    zip.file("index.js", indexContents);
    return zip.generateNodeStream({
        compression: "DEFLATE",
        compressionOptions: { level: 8 }
    });
}
