import * as cloudify from "../cloudify";
import * as funcs from "./aws-exec";
import * as fs from "fs";
import * as uuidv4 from "uuid/v4";
import { S3 } from "aws-sdk";

export async function buildModulesOnLambda(packageJson: string) {
    const aws = new cloudify.AWS();
    const lambda = await aws.createFunction(require.resolve("./aws-exec"), {
        timeout: 300,
        memorySize: 1024,
        useQueue: false
    });
    try {
        const remote = lambda.cloudifyAll(funcs);

        const npmVersion = await remote.exec(["npm -v"]);
        console.log(npmVersion);

        const packageJsonContents = fs.readFileSync(packageJson);
        console.log(`package.json contents:`, packageJsonContents.toString());
        const Bucket = uuidv4();
        const s3 = new S3();
        await s3.createBucket({ Bucket }).promise();
        return await remote.npmInstall(packageJsonContents.toString(), Bucket);
    } catch (err) {
        console.error(err);
    } finally {
        await lambda.cleanup();
    }
    return "";
}
