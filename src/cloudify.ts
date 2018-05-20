import Axios from "axios";
import { createHash } from "crypto";
import * as fs from "fs";
import humanStringify from "human-stringify";
import { Readable } from "stream";
import { FunctionCall, FunctionReturn, packer } from "./functionserver";
import { CloudFunctions, cloudfunctions_v1 as gcf, initializeGoogleAPIs } from "./google";
import { log } from "./log";

type AnyFunction = (...args: any[]) => any;

type Unpacked<T> = T extends Promise<infer U> ? U : T;

type PromisifiedFunction<T extends AnyFunction> =
    // prettier-ignore
    T extends () => infer U ? () => Promise<Unpacked<U>> :
    T extends (a1: infer A1) => infer U ? (a1: A1) => Promise<Unpacked<U>> :
    T extends (a1: infer A1, a2: infer A2) => infer U ? (a1: A1, a2: A2) => Promise<Unpacked<U>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3) => infer U ? (a1: A1, a2: A2, a3: A3) => Promise<Unpacked<U>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4) => infer U ? (a1: A1, a2: A2, a3: A3, a4: A4) => Promise<Unpacked<U>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5) => infer U ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5) => Promise<Unpacked<U>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5, a6: infer A6) => infer U ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6) => Promise<Unpacked<U>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5, a6: infer A6, a7: infer A7) => infer U ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7) => Promise<Unpacked<U>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5, a6: infer A6, a7: infer A7, a8: infer A8) => infer U ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7, a8: A8) => Promise<Unpacked<U>> :
    T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4, a5: infer A5, a6: infer A6, a7: infer A7, a8: infer A8, a9: infer A9) => infer U ? (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7, a8: A8, a9: A9) => Promise<Unpacked<U>> :
    T extends (...args: any[]) => infer U ? (...args: any[]) => Promise<Unpacked<U>> : T;

type Promisified<T> = {
    [K in keyof T]: T[K] extends AnyFunction ? PromisifiedFunction<T[K]> : never
};

interface CloudFunctionFactory {
    cloudify<F extends AnyFunction>(fn: F): PromisifiedFunction<F>;
    cloudifyAll<M>(importedModule: M): Promisified<M>;
    cleanup(): Promise<void>;
}

export interface CloudifyGoogleOptions {
    region?: string;
    description?: string;
    entryPoint?: string;
    timeout?: number;
    availableMemoryMb?: number;
    labels?: { [key: string]: string };
}

export class CloudifyGoogle implements CloudFunctionFactory {
    protected constructor(
        readonly googleCloudFunctionsApi: CloudFunctions,
        readonly trampoline: string
    ) {}

    static async create(
        serverModule: string,
        {
            region = "us-central1",
            description = "cloudify trampoline function",
            entryPoint = "trampoline",
            timeout = 60,
            availableMemoryMb = 256,
            labels = {}
        }: CloudifyGoogleOptions = {}
    ) {
        const serverFile = require.resolve(serverModule);
        const { archive, hash: codeHash } = await packer(serverFile);
        log(`hash: ${codeHash}`);

        const google = await initializeGoogleAPIs();
        const project = await google.auth.getDefaultProjectId();
        const googleCloudFunctionsApi = new CloudFunctions(google, project);

        log(`Create cloud function`);

        const locationPath = googleCloudFunctionsApi.locationPath(region);
        const uploadUrlResponse = await googleCloudFunctionsApi.generateUploaddUrl(
            locationPath
        );
        const uploadResult = await uploadZip(uploadUrlResponse.uploadUrl!, archive);
        log(`Upload zip file response: ${uploadResult.statusText}`);

        let functionRequest: gcf.Schema$CloudFunction = {
            description,
            entryPoint,
            timeout: `${timeout}s`,
            availableMemoryMb,
            httpsTrigger: {},
            sourceUploadUrl: uploadUrlResponse.uploadUrl,
            labels: {
                ...labels,
                codehasha: codeHash.slice(0, 32),
                codehashb: codeHash.slice(32),
                nonce: `${Math.random()}`.replace(".", "")
            }
        };

        validateLabels(functionRequest.labels);

        const configHash = getSha256(JSON.stringify(functionRequest));

        const trampoline = googleCloudFunctionsApi.functionPath(
            region,
            "cloudify-" + configHash.slice(0, 35)
        );
        functionRequest.name = trampoline;

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
            await googleCloudFunctionsApi.deleteFunction(trampoline).catch(_ => {});
            throw err;
        }
        return new CloudifyGoogle(googleCloudFunctionsApi, trampoline);
    }

    /**
     *
     * @param {(...args: any[]) => R} fn Parameters can be any value that can be JSON.stringify'd
     * @returns {(...args: any[]) => Promise<R>} A return value that can be JSON.stringify'd
     * @memberof CloudFactory
     */
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

function getSha256(data: string): string {
    const hasher = createHash("sha256");
    hasher.update(JSON.stringify(data));
    return hasher.digest("hex");
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
function validateLabels(labels: object) {
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

async function testPacker(serverModule: string) {
    const output = fs.createWriteStream("dist.zip");

    const serverFile = require.resolve(serverModule);
    const { archive, hash } = await packer(serverFile);
    archive.pipe(output);
    log(`hash: ${hash}`);
}

if (process.argv.length > 2 && process.argv[2] === "--test") {
    testPacker("./server");
}
