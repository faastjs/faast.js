import Axios from "axios";
import humanStringify from "human-stringify";
import { Readable } from "stream";
import {
    AnyFunction,
    CloudFunctionService,
    FunctionCall,
    FunctionReturn,
    Promisified,
    PromisifiedFunction,
    getConfigHash
} from "../cloudify";
import { log } from "../log";
import { PackerResult, packer } from "../packer";
import {
    CloudFunctions,
    cloudfunctions_v1 as gcf,
    initializeGoogleAPIs
} from "./google-cloud-functions-api";

export interface CloudifyGoogleOptions extends gcf.Schema$CloudFunction {
    region?: string;
    timeoutSec?: number;
    availableMemoryMb?: number;
}

export class CloudifyGoogle implements CloudFunctionService {
    name = "google";

    protected constructor(
        protected googleCloudFunctionsApi: CloudFunctions,
        protected trampoline: string
    ) {}

    static async create(serverModule: string, options: CloudifyGoogleOptions = {}) {
        const { archive, hash: codeHash } = await packGoogleCloudFunction(serverModule);
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
        return new CloudifyGoogle(googleCloudFunctionsApi, trampoline);
    }

    cloudify<F extends AnyFunction>(fn: F): PromisifiedFunction<F> {
        const promisifedFunc = async (...args: any[]) => {
            let callArgs: FunctionCall = {
                name: fn.name,
                args
            };
            const callArgsStr = JSON.stringify(callArgs);
            log(`Calling cloud function "${fn.name}" with args: ${callArgsStr}`, "");
            const response = await this.googleCloudFunctionsApi!.callFunction(
                this.trampoline,
                callArgsStr
            );

            if (response.error) {
                throw new Error(response.error);
            }
            log(`  returned: ${response.result}`);
            let returned: FunctionReturn = JSON.parse(response.result!);
            if (returned.type === "error") {
                throw returned.value;
            }
            return returned.value;
        };
        return promisifedFunc as any;
    }

    cloudifyAll<T>(funcs: T): Promisified<T> {
        const rv: any = {};
        for (const name of Object.keys(funcs)) {
            if (typeof funcs[name] === "function") {
                rv[name] = this.cloudify(funcs[name]);
            }
        }
        return rv;
    }

    async cleanup() {
        await this.googleCloudFunctionsApi.deleteFunction(this.trampoline).catch(_ => {});
    }
}

export async function packGoogleCloudFunction(
    functionModule: string
): Promise<PackerResult> {
    return packer({
        trampolineModule: require.resolve("./google-trampoline"),
        functionModule
    });
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
