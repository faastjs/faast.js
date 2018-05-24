import * as fs from "fs";
import { packGoogleCloudFunction } from "../src/cloudify";
import { exec, unzipInDir } from "./util";

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

        const dir = "tmp/google";
        unzipInDir(dir, "dist-google.zip");
        expect(exec(`cd ${dir} && node index.js`)).toMatch(
            "Successfully loaded functions"
        );
        exec("functions start");
        exec(`cd ${dir} && functions deploy trampoline --trigger-http`);
        expect(
            exec(
                `functions call trampoline --data='{"name": "hello", "args": ["world"]}'`
            )
        ).toMatch("Hello world!");
        exec("functions stop");
    },
    60 * 1000
);
