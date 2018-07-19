import * as archiver from "archiver";
import { S3 } from "aws-sdk";
import * as sys from "child_process";
import * as fs from "fs";
import * as path from "path";

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
    Key: string
) {
    let rv = "";
    fs.mkdirSync(buildDir);
    fs.writeFileSync(path.join(buildDir, "package.json"), packageJsonContents);
    fs.writeFileSync(path.join(buildDir, "index.js"), indexContents);
    rv += exec([`export HOME=/tmp && npm install --prefix=${buildDir}`]);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.directory(buildDir, false).finalize();
    await s3.upload({ Bucket, Key, Body: archive }).promise();
    return rv;
}
