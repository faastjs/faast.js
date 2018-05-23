import * as fs from "fs";
import { packAWSLambdaFunction, packGoogleCloudFunction } from "./cloudify";
import { runClients } from "./client";

require("source-map-support").install();

const log = console.log;

async function testPacker(serverModule: string) {
    const outputGoogle = fs.createWriteStream("dist-google.zip");
    const { archive: archiveGoogle } = await packGoogleCloudFunction(serverModule);
    archiveGoogle.pipe(outputGoogle);

    const outputAWS = fs.createWriteStream("dist-aws.zip");
    const { archive: archiveAWS } = await packAWSLambdaFunction(serverModule);
    archiveAWS.pipe(outputAWS);
}

if (process.argv.length > 2 && process.argv[2] === "--test") {
    testPacker("./functions");
} else {
    runClients().catch(err => console.log(err));
}
