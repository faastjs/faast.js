// On the client

import { google } from "googleapis";
import { CloudFunctions, initializeGoogleAPIs } from "./google";
import humanStringify from "human-stringify";
import { sha256ofFile } from "./hash";
import * as fs from "fs";
import Axios from "axios";

let cloudFunctions: CloudFunctions;

const location = "us-central1";
const zipFile = "dist.zip";
const entryPoint = "trampoline";
const funcName = "cloudify-trampoline";

export interface FunctionCall {
    name: string;
    args: any[];
}

export interface FunctionReturn {
    type: "returned" | "error";
    message?: string;
    value?: any;
}

export interface CreateFunctionWithZipFileOptions {
    location: string;
    funcName: string;
    zipFile: string;
    description: string;
    entryPoint: string;
    labels?: { [key: string]: string };
    timeout?: number;
    availableMemoryMb?: number;
}

export async function createFunctionWithZipFile(
    cloudFunctions: CloudFunctions,
    {
        location,
        funcName,
        zipFile,
        description,
        entryPoint,
        labels = {},
        timeout = 60,
        availableMemoryMb = 256
    }: CreateFunctionWithZipFileOptions
) {
    console.log(`Create cloud function`);
    const funcPath = cloudFunctions.functionPath(location, funcName);
    const locationPath = cloudFunctions.locationPath(location);
    const sha256 = await sha256ofFile(zipFile);

    console.log(`  funcPath: ${funcPath}`);
    console.log(`  locationPath: ${locationPath}`);
    const uploadUrlResponse = await cloudFunctions.generateUploaddUrl(locationPath);
    console.log(`upload URL: ${uploadUrlResponse.uploadUrl}, zipFile: ${zipFile}`);
    // upload ZIP file to uploadUrlResponse.uploadUrl
    const putResult = await Axios.put(
        uploadUrlResponse.uploadUrl!,
        fs.createReadStream(zipFile),
        {
            headers: {
                "content-type": "application/zip",
                "x-goog-content-length-range": "0,104857600"
            }
        }
    );

    console.log(`Put response: ${putResult.statusText}`);

    console.log(`creating function`);

    // Split the hash into two labels because Google Cloud has a 64-character
    // limit per label value.
    const sha256p1 = sha256.slice(0, 32);
    const sha256p2 = sha256.slice(32);

    const functionRequest = {
        name: funcPath,
        description,
        entryPoint,
        timeout: `${timeout}s`,
        availableMemoryMb,
        sourceUploadUrl: uploadUrlResponse.uploadUrl,
        httpsTrigger: { url: "" },
        labels: { ...labels, sha256p1, sha256p2 }
    };

    const existingFunc = await cloudFunctions.getFunction(funcPath).catch(_ => undefined);
    if (existingFunc) {
        const {
            labels: { sha256p1, sha256p2 }
        } = existingFunc;
        const previousHash = sha256p1 + sha256p2;
        if (previousHash && previousHash === sha256) {
            console.log(`Function unchanged, hash matches: ${previousHash}`);
            return;
        } else {
            console.log(`Function exists but hashes differ`);
            console.log(`Deleting function`);
            console.group();
            console.log(`funcPath: ${funcPath}`);
            console.log(humanStringify(functionRequest));
            console.groupEnd();
            await cloudFunctions.deleteFunction(funcPath);
        }
    }
    console.log(`Create function`);
    console.group();
    console.log(`locationPath: ${locationPath}`);
    console.log(humanStringify(functionRequest));
    console.groupEnd();
    await cloudFunctions.createFunction(locationPath, functionRequest);
}

export async function init() {
    const google = await initializeGoogleAPIs();
    const project = await google.auth.getDefaultProjectId();
    cloudFunctions = new CloudFunctions(google, project);
    await createFunctionWithZipFile(cloudFunctions, {
        location,
        funcName,
        zipFile,
        description: funcName,
        entryPoint
    }).catch(err => console.error(`Error: ${err.message}`));
}

export function cloudify<T, R>(fn: (arg: T) => Promise<R>): typeof fn;

export function cloudify<T0, T1, R>(
    fn: (a0: T0, a1: T1) => Promise<R>
): (a0: T0, a1: T1) => Promise<R>;

export function cloudify<T0, T1, T2, R>(
    fn: (a0: T0, a1: T1, a2: T2) => Promise<R>
): typeof fn;

export function cloudify<T0, T1, T2, T3, R>(
    fn: (a0: T0, a1: T1, a2: T2, a3: T3) => Promise<R>
): typeof fn;

export function cloudify<T0, T1, T2, T3, T4, R>(
    fn: (a0: T0, a1: T1, a2: T2, a3: T3, a4: T4) => Promise<R>
): typeof fn;

export function cloudify<T0, T1, T2, T3, T4, T5, R>(
    fn: (a0: T0, a1: T1, a2: T2, a3: T3, a4: T4, a5: T5) => Promise<R>
): typeof fn;

export function cloudify<T0, T1, T2, T3, T4, T5, T6, R>(
    fn: (a0: T0, a1: T1, a2: T2, a3: T3, a4: T4, a5: T5, a6: T6) => Promise<R>
): typeof fn;

export function cloudify<T0, T1, T2, T3, T4, T5, T6, T7, R>(
    fn: (a0: T0, a1: T1, a2: T2, a3: T3, a4: T4, a5: T5, a6: T6, a7: T7) => Promise<R>
): typeof fn;

export function cloudify<T0, T1, T2, T3, T4, T5, T6, T7, T8, R>(
    fn: (
        a0: T0,
        a1: T1,
        a2: T2,
        a3: T3,
        a4: T4,
        a5: T5,
        a6: T6,
        a7: T7,
        a8: T8
    ) => Promise<R>
): typeof fn;

export function cloudify<T, R>(fn: (arg: T) => R): (arg: T) => Promise<R>;

export function cloudify<T0, T1, R>(
    fn: (a0: T0, a1: T1) => R
): (a0: T0, a1: T1) => Promise<R>;

export function cloudify<T0, T1, T2, R>(
    fn: (a0: T0, a1: T1, a2: T2) => R
): (a0: T0, a1: T1, a2: T2) => Promise<R>;

export function cloudify<T0, T1, T2, T3, R>(
    fn: (a0: T0, a1: T1, a2: T2, a3: T3) => R
): (a0: T0, a1: T1, a2: T2, a3: T3) => Promise<R>;

export function cloudify<T0, T1, T2, T3, T4, R>(
    fn: (a0: T0, a1: T1, a2: T2, a3: T3, a4: T4) => R
): (a0: T0, a1: T1, a2: T2, a3: T3, a4: T4) => Promise<R>;

export function cloudify<T0, T1, T2, T3, T4, T5, R>(
    fn: (a0: T0, a1: T1, a2: T2, a3: T3, a4: T4, a5: T5) => R
): (a0: T0, a1: T1, a2: T2, a3: T3, a4: T4, a5: T5) => Promise<R>;

export function cloudify<T0, T1, T2, T3, T4, T5, T6, R>(
    fn: (a0: T0, a1: T1, a2: T2, a3: T3, a4: T4, a5: T5, a6: T6) => R
): (a0: T0, a1: T1, a2: T2, a3: T3, a4: T4, a5: T5, a6: T6) => Promise<R>;

export function cloudify<T0, T1, T2, T3, T4, T5, T6, T7, R>(
    fn: (a0: T0, a1: T1, a2: T2, a3: T3, a4: T4, a5: T5, a6: T6, a7: T7) => R
): (a0: T0, a1: T1, a2: T2, a3: T3, a4: T4, a5: T5, a6: T6, a7: T7) => Promise<R>;

export function cloudify<T0, T1, T2, T3, T4, T5, T6, T7, T8, R>(
    fn: (a0: T0, a1: T1, a2: T2, a3: T3, a4: T4, a5: T5, a6: T6, a7: T7, a8: T8) => R
): (a0: T0, a1: T1, a2: T2, a3: T3, a4: T4, a5: T5, a6: T6, a7: T7, a8: T8) => Promise<R>;

export function cloudify<R>(fn: (...args: any[]) => R): (...args: any[]) => Promise<R> {
    const funcPath = cloudFunctions.functionPath(location, funcName);

    return async (...args: any[]) => {
        let callArgs: FunctionCall = {
            name: fn.name,
            args
        };
        const callArgsStr = JSON.stringify(callArgs);
        console.log(`[client] Calling cloud function with arg: ${callArgsStr}`);
        const response = await cloudFunctions.callFunction(funcPath, callArgsStr);
        if (response.error) {
            throw new Error(response.error);
        }
        let returned: FunctionReturn = JSON.parse(response.result!);
        if (returned.type === "error") {
            throw new Error(returned.message);
        }
        return returned.value as R;
    };
}

export async function cleanup() {
    // const funcPath = cloudFunctions.functionPath(location, funcName);
    // await cloudFunctions.deleteFunction(funcPath);
}
