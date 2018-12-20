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
        if (!gcpKey.Parameter) {
            throw new Error(`key '${key}' not found`);
        }
        const decodedKey = Buffer.from(gcpKey.Parameter.Value, "base64").toString();
        await writeFile("gcp-key.json", decodedKey, { mode: 0o600 });
        process.env["GOOGLE_APPLICATION_CREDENTIALS"] = join(cwd(), "gcp-key.json");
    } catch (err) {
        console.warn(`Could not find Google service account key: ${err}`);
    }
}

setupAWSCodeBuild();
