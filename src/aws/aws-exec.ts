import * as sys from "child_process";
import * as fs from "fs";
import { S3 } from "aws-sdk";

export function exec(cmds: string[]) {
    let rv = "";
    for (const cmd of cmds) {
        rv += sys.execSync(cmd).toString();
    }
    return rv;
}

export async function npmInstall(packageJsonContents: string, Bucket: string) {
    let rv = "";
    rv += exec(["mkdir /tmp/build"]);
    fs.writeFileSync("/tmp/build/package.json", packageJsonContents);
    rv += exec([
        "cp index.js /tmp/build",
        "export HOME=/tmp && npm install --prefix=/tmp/build",
        "du -h /tmp/build"
    ]);

    const s3 = new S3();
    await s3.upload({ Bucket, Key: "Key", Body: "Hello" }).promise();
    return rv;
}
