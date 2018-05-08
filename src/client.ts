// On the client

import { CloudFunctions } from "./google";
import { google } from "googleapis";
import { initializeGoogleAPIs } from "./shared";

let cloudFunctions: CloudFunctions;

class CloudFactory {
    async createCloudFunctions() {
        const project = await google.auth.getDefaultProjectId();
        return new CloudFunctions(google, project);
    }
}

export async function init() {
    cloudFunctions = await new CloudFactory().createCloudFunctions();
    await cloudFunctions.createFunctionWithZipFile(
        location,
        funcName,
        "dist.zip",
        funcName,
        "trampoline"
    );
}

const location = "us-central1";
const funcName = "trampoline";

export function cloudify<A, R>(fn: (arg: A) => R) {
    const funcPath = cloudFunctions.functionPath(location, funcName);
    console.log(fn.toString());
    console.log(`NAME: ${fn.name}`);

    return async (arg: A) => {
        const response = await cloudFunctions.callFunction(funcPath, JSON.stringify(arg));
        return JSON.parse(response.result!) as R;
    };
}
