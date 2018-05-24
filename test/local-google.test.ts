import * as sys from "child_process";
import * as fs from "fs";
import { packAWSLambdaFunction, packGoogleCloudFunction } from "../src/cloudify";

function exec(cmd: string) {
    console.log(sys.execSync(cmd).toString());
}

test(
    "package google zip file and test with clound function emulator",
    async () => {
        const { archive: archiveGoogle } = await packGoogleCloudFunction(
            require.resolve("./functions")
        );

        await new Promise((resolve, reject) => {
            const outputGoogle = fs.createWriteStream("dist-google.zip");
            outputGoogle.on("finish", resolve);
            outputGoogle.on("error", reject);
            archiveGoogle.pipe(outputGoogle);
        });

        exec(
            "rm -rf tmp && mkdir tmp && cp dist-google.zip tmp && cd tmp && unzip -o dist-google.zip"
        );
        exec("functions start");
        exec("cd tmp && functions deploy trampoline --trigger-http");
        exec(`functions call trampoline --data='{"name": "hello", "args": ["world"]}'`);
        exec("functions stop");
        exec("functions logs read --limit=10");
    },
    120 * 1000
);

test("package aws zip file", async () => {
    const { archive: archiveAWS } = await packAWSLambdaFunction(
        require.resolve("./functions")
    );
    await new Promise((resolve, reject) => {
        const outputAWS = fs.createWriteStream("dist-aws.zip");
        outputAWS.on("finish", resolve);
        outputAWS.on("error", reject);
        archiveAWS.pipe(outputAWS);
    });
});
