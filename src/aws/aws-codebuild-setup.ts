import { join } from "path";
import { cwd } from "process";
import { SSM } from "aws-sdk";
import { writeFile } from "../fs";

export async function setupAWSCodeBuild() {
    try {
        const key = "/test/gcp-key";
        const ssm = new SSM();
        const gcpKey = await ssm
            .getParameter({ Name: key, WithDecryption: true })
            .promise();
        if (!gcpKey.Parameter || !gcpKey.Parameter.Value) {
            throw new Error(`key '${key}' not found`);
        }
        const decodedKey = Buffer.from(gcpKey.Parameter.Value, "base64").toString();
        console.log(`decoded key len: ${decodedKey.length}`);
        const keyFile = join(cwd(), "gcp-key.json");
        console.log(`CWD: ${cwd()}`);
        console.log(`gcp key file: ${keyFile}`);
        await writeFile(keyFile, decodedKey, { mode: 0o600 });
        process.env["GOOGLE_APPLICATION_CREDENTIALS"] = keyFile;
    } catch (err) {
        console.warn(`Could not find Google service account key: ${err}`);
    }
}

setupAWSCodeBuild();
