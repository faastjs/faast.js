import Axios from "axios";
import humanStringify from "human-stringify";
import { Readable } from "stream";
import * as uuidv4 from "uuid/v4";
import { AnyFunction, Response, ResponsifiedFunction } from "../cloudify";
import { log } from "../log";
import { PackerResult, packer } from "../packer";
import { FunctionCall, FunctionReturn } from "../shared";
import {
    CloudFunctions,
    cloudfunctions_v1beta2 as gcf,
    initializeGoogleAPIs
} from "./google-cloud-functions-api";

export interface Options extends gcf.Schema$CloudFunction {
    region?: string;
    timeoutSec?: number;
    availableMemoryMb?: number;
}

export interface GoogleVariables {
    readonly trampoline: string;
}

export interface GoogleServices {
    readonly googleCloudFunctionsApi: CloudFunctions;
}

export const name: string = "google";

export type State = GoogleVariables & GoogleServices;

export async function initialize(
    serverModule: string,
    options: Options = {}
): Promise<State> {
    const google = await initializeGoogleAPIs();
    const project = await google.auth.getDefaultProjectId();
    const googleCloudFunctionsApi = new CloudFunctions(
        google.cloudfunctions("v1beta2"),
        project
    );
    return initializeWithApi(serverModule, options, googleCloudFunctionsApi);
}

import * as sys from "child_process";
import * as fs from "fs";

export async function initializeEmulator(serverModule: string, options: Options = {}) {
    exec("functions start");
    const result = exec(`functions status`).match(
        /REST Service\s+│\s+(http:\/\/localhost:\S+)/
    );
    if (!result || !result[1]) {
        throw new Error("Could not find cloud functions service REST url");
    }
    const url = result[1];

    // Adjust localhost:8008 to match the host and port where your Emulator is running
    const DISCOVERY_URL = `${url}$discovery/rest?version=v1beta2`;
    log(`DISCOVERY_URL: ${DISCOVERY_URL}`);
    const google = await initializeGoogleAPIs();
    const emulator = await google.discoverAPI(DISCOVERY_URL);
    const project = await google.auth.getDefaultProjectId();
    const googleCloudFunctionsApi = new CloudFunctions(emulator as any, project);
    return initializeWithApi(serverModule, options, googleCloudFunctionsApi);
}

async function initializeWithApi(
    serverModule: string,
    options: Options,
    googleCloudFunctionsApi: CloudFunctions
) {
    log(`Create cloud function`);
    const { archive } = await pack(serverModule);
    const nonce = uuidv4();
    log(`Nonce: ${nonce}`);
    const { region = "us-central1", timeoutSec = 60, ...rest } = options;
    const locationPath = googleCloudFunctionsApi.locationPath(region);
    const uploadUrlResponse = await googleCloudFunctionsApi.generateUploaddUrl(
        locationPath
    );
    const uploadResult = await uploadZip(uploadUrlResponse.uploadUrl!, archive);
    log(`Upload zip file response: ${uploadResult.statusText}`);
    const trampoline = googleCloudFunctionsApi.functionPath(region, "cloudify-" + nonce);
    const functionRequest: gcf.Schema$CloudFunction = {
        name: trampoline,
        entryPoint: "trampoline",
        timeout: `${timeoutSec}s`,
        availableMemoryMb: 256,
        httpsTrigger: {},
        sourceUploadUrl: uploadUrlResponse.uploadUrl,
        ...rest
    };
    validateGoogleLabels(functionRequest.labels);
    // It should be rare to get a trampoline collision because we include
    // part of the sha256 hash as part of the name, but we check just in
    // case.
    const existingFunc = await googleCloudFunctionsApi
        .getFunction(trampoline)
        .catch(_ => undefined);
    if (existingFunc) {
        throw new Error(`Trampoline name hash collision`);
    }
    log(`Create function at ${locationPath}`);
    log(humanStringify(functionRequest));
    try {
        await googleCloudFunctionsApi.createFunction(locationPath, functionRequest);
    } catch (err) {
        log(`createFunction error: ${err.stack}`);
        try {
            await googleCloudFunctionsApi.deleteFunction(trampoline);
        } catch (err) {
            log(`Could not clean up after failed create function. Possible leak.`);
            log(err);
        }
        throw err;
    }
    log(`Successfully created function ${trampoline}`);
    return { googleCloudFunctionsApi, trampoline };
}

export function exec(cmd: string) {
    const result = sys.execSync(cmd).toString();
    console.log(result);
    return result;
}

export function cloudifyWithResponse<F extends AnyFunction>(
    state: State,
    fn: F
): ResponsifiedFunction<F> {
    const promisifedFunc = async (...args: any[]) => {
        let callArgs: FunctionCall = {
            name: fn.name,
            args
        };
        const callArgsStr = JSON.stringify(callArgs);
        log(`Calling cloud function "${fn.name}" with args: ${callArgsStr}`, "");
        const rawResponse = await state.googleCloudFunctionsApi!.callFunction(
            state.trampoline,
            callArgsStr
        );
        let error: Error | undefined;
        if (rawResponse.error) {
            error = new Error(rawResponse.error);
        }
        log(`  returned: ${rawResponse.result}`);
        let returned: FunctionReturn | undefined =
            !error && JSON.parse(rawResponse.result!);
        if (returned && returned.type === "error") {
            const errValue = returned.value;
            error = new Error(errValue.message);
            error.name = errValue.name;
            error.stack = errValue.stack;
        }
        const value = returned && returned.value;

        const rv: Response<ReturnType<F>> = { error, value, rawResponse };
        return rv;
    };
    return promisifedFunc as any;
}

export async function cleanup(state: State) {
    await state.googleCloudFunctionsApi.deleteFunction(state.trampoline).catch(_ => {});
}

/**
 * @param labels The labels applied to a resource must meet the following
 * requirements:
 *
 * Each resource can have multiple labels, up to a maximum of 64. Each label
 * must be a key-value pair. Keys have a minimum length of 1 character and a
 * maximum length of 63 characters, and cannot be empty. Values can be empty,
 * and have a maximum length of 63 characters. Keys and values can contain only
 * lowercase letters, numeric characters, underscores, and dashes. All
 * characters must use UTF-8 encoding, and international characters are allowed.
 * The key portion of a label must be unique. However, you can use the same key
 * with multiple resources. Keys must start with a lowercase letter or
 * international character. For a given reporting service and project, the
 * number of distinct key-value pair combinations that will be preserved within
 * a one-hour window is 1,000. For example, the Compute Engine service reports
 * metrics on virtual machine (VM) instances. If you deploy a project with 2,000
 * VMs, each with a distinct label, the service reports metrics are preserved
 * for only the first 1,000 labels that exist within the one-hour window.
 */
function validateGoogleLabels(labels: object | undefined) {
    if (!labels) {
        return;
    }
    const keys = Object.keys(labels);
    if (keys.length > 64) {
        throw new Error("Cannot exceeded 64 labels");
    }
    if (keys.find(key => typeof key !== "string" || typeof labels[key] !== "string")) {
        throw new Error(`Label keys and values must be strings`);
    }
    if (keys.find(key => key.length > 63 || labels[key].length > 63)) {
        throw new Error(`Label keys and values cannot exceed 63 characters`);
    }
    if (keys.find(key => key.length === 0)) {
        throw new Error(`Label keys must have length > 0`);
    }
    const pattern = /^[a-z0-9_-]*$/;
    if (keys.find(key => !key.match(pattern) || !labels[key].match(pattern))) {
        throw new Error(
            `Label keys and values can contain only lowercase letters, numeric characters, underscores, and dashes.`
        );
    }
}

async function uploadZip(url: string, zipStream: Readable) {
    return await Axios.put(url, zipStream, {
        headers: {
            "content-type": "application/zip",
            "x-goog-content-length-range": "0,104857600"
        }
    });
}

export async function pack(functionModule: string): Promise<PackerResult> {
    return packer({
        trampolineModule: require.resolve("./google-trampoline"),
        functionModule
    });
}

export function getResourceList(state: State) {
    return state.trampoline;
}

export async function cleanupResources(resources: string) {
    const trampoline = resources;
    const google = await initializeGoogleAPIs();
    const project = await google.auth.getDefaultProjectId();
    const googleCloudFunctionsApi = new CloudFunctions(
        google.cloudfunctions("v1beta2"),
        project
    );
    return cleanup({ trampoline, googleCloudFunctionsApi });
}
