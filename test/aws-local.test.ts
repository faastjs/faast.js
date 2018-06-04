import * as fs from "fs";
import { create } from "../src/cloudify";
import { exec, unzipInDir } from "./util";

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
    process.env;
    expect(exec(`cd ${dir} && node index.js`)).toMatch(
        "Successfully loaded cloudify trampoline function."
    );
});
