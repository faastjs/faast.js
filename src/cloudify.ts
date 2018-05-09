// On the client

import { google } from "googleapis";
import { CloudFunctions, initializeGoogleAPIs } from "./google";
import humanStringify from "human-stringify";
import { FunctionCall, FunctionReturn } from "./functionserver";

let cloudFunctions: CloudFunctions;

export async function init() {
    const google = await initializeGoogleAPIs();
    const project = await google.auth.getDefaultProjectId();
    cloudFunctions = new CloudFunctions(google, project);
    await cloudFunctions
        .createFunctionWithZipFile(location, funcName, "dist.zip", funcName, "trampoline")
        .catch(err => console.log(err));
}

const location = "us-central1";
const funcName = "trampoline";

export function cloudify<A, R>(fn: (arg: A) => R) {
    const funcPath = cloudFunctions.functionPath(location, funcName);
    console.log(fn.toString());

    return async (arg: A) => {
        let callArgs: FunctionCall = {
            name: fn.name,
            args: [arg]
        };
        const callArgsStr = JSON.stringify(callArgs);
        console.log(`Calling cloud function with arg: ${callArgsStr}`);
        const response = await cloudFunctions.callFunction(funcPath, callArgsStr);
        if (response.error) {
            console.log(response.error);
            throw response.error;
        }
        let returned: FunctionReturn = JSON.parse(response.result!);
        return returned.value as R;
    };
}
