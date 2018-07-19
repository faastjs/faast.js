import * as archiver from "archiver";
import { S3 } from "aws-sdk";
import * as sys from "child_process";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import * as extract from "extract-zip";

export function exec(cmds: string[]) {
    let rv = "";
    for (const cmd of cmds) {
        rv += sys.execSync(cmd).toString();
    }
    return rv;
}

const buildDir = "/tmp/build";
const s3 = new S3();

export async function npmInstall(
    packageJsonContents: string,
    indexContents: string,
    Bucket: string,
    Key: string,
    caching: boolean
) {
    let rv = "";
    fs.mkdirSync(buildDir);
    fs.writeFileSync(path.join(buildDir, "package.json"), packageJsonContents);

    rv += "Checking cache\n";
    if (caching) {
        const hasher = createHash("sha256");
        hasher.update(packageJsonContents);
        const hash = hasher.digest("hex");
        const cached = await s3
            .getObject({ Bucket: "cloudify-cache", Key: hash })
            .promise()
            .catch(_ => {});

        if (cached) {
            rv += "CACHED\n";
            const packageFile = `${buildDir}/package.zip`;
            fs.writeFileSync(packageFile, cached.Body);
            await new Promise((resolve, reject) =>
                extract(packageFile, { dir: buildDir }, err => {
                    if (err) {
                        reject(err);
                    }
                    resolve();
                })
            );
            fs.unlinkSync(packageFile);
        } else {
            rv += "NOT CACHED\n";
            rv += exec([`export HOME=/tmp && npm install --prefix=${buildDir}`]);
            const cacheArchive = archiver("zip", { zlib: { level: 9 } });
            cacheArchive.directory(buildDir, false).finalize();
            s3.createBucket({ Bucket: "cloudify-cache" })
                .promise()
                .catch(_ => {});
            await s3
                .upload({ Bucket: "cloudify-cache", Key: hash, Body: cacheArchive })
                .promise()
                .catch(err => console.error(err));
        }
    } else {
        rv += exec([`export HOME=/tmp && npm install --prefix=${buildDir}`]);
    }

    fs.writeFileSync(path.join(buildDir, "index.js"), indexContents);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.directory(buildDir, false).finalize();
    await s3.upload({ Bucket, Key, Body: archive }).promise();
    return rv;
}
