import Axios from "axios";
import humanStringify from "human-stringify";
import { Readable } from "stream";
import { AnyFunction, Response, ResponsifiedFunction } from "../cloudify";
import { log } from "../log";
import { PackerResult, packer } from "../packer";
import { FunctionCall, FunctionReturn, getConfigHash } from "../shared";
import {
    CloudFunctions,
    cloudfunctions_v1 as gcf,
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

export const name = "google";

export type State = GoogleVariables & GoogleServices;

export async function initialize(
    serverModule: string,
    options: Options = {}
): Promise<State> {
    const { archive, hash: codeHash } = await pack(serverModule);
    log(`hash: ${codeHash}`);

    const google = await initializeGoogleAPIs();
    const project = await google.auth.getDefaultProjectId();
    const googleCloudFunctionsApi = new CloudFunctions(google, project);

    log(`Create cloud function`);
    const { region = "us-central1", timeoutSec = 60, labels, ...rest } = options;
    const locationPath = googleCloudFunctionsApi.locationPath(region);
    const uploadUrlResponse = await googleCloudFunctionsApi.generateUploaddUrl(
        locationPath
    );
    const uploadResult = await uploadZip(uploadUrlResponse.uploadUrl!, archive);
    log(`Upload zip file response: ${uploadResult.statusText}`);

    const configHash = getConfigHash(codeHash, options);

    const trampoline = googleCloudFunctionsApi.functionPath(
        region,
        "cloudify-" + configHash.slice(0, 35)
    );

    const functionRequest: gcf.Schema$CloudFunction = {
        name: trampoline,
        description: "cloudify trampoline function",
        entryPoint: "trampoline",
        timeout: `${timeoutSec}s`,
        availableMemoryMb: 256,
        httpsTrigger: {},
        sourceUploadUrl: uploadUrlResponse.uploadUrl,
        labels: {
            confighasha: configHash.slice(0, 32),
            confighashb: configHash.slice(32),
            ...labels
        },
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
        await googleCloudFunctionsApi
            .deleteFunction(trampoline)
            .catch(_ =>
                log(`Could not clean up after failed create function. Possible leak.`)
            );
        throw err;
    }
    return { googleCloudFunctionsApi, trampoline };
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
function validateGoogleLabels(labels: object) {
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
