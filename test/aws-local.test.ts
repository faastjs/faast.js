import * as sys from "child_process";
import * as fs from "fs";
import { create } from "../src/cloudify";

export function exec(cmd: string) {
    const result = sys.execSync(cmd).toString();
    console.log(result);
    return result;
}

export function unzipInDir(dir: string, zipFile: string) {
    exec(
        `rm -rf ${dir} && mkdir -p ${dir} && cp ${zipFile} ${dir} && cd ${dir} && unzip -o ${zipFile}`
    );
}

test("package aws zip file", async () => {
    const { archive: archiveAWS } = await create("aws").pack("./functions");

    await new Promise((resolve, reject) => {
        const outputAWS = fs.createWriteStream("dist-aws.zip");
        outputAWS.on("finish", resolve);
        outputAWS.on("error", reject);
        archiveAWS.pipe(outputAWS);
    });
    const dir = "tmp/aws";
    unzipInDir(dir, "dist-aws.zip");
    expect(exec(`cd ${dir} && node index.js`)).toMatch(
        "Successfully loaded cloudify trampoline function."
    );
});
