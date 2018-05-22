import * as aws from "aws-sdk";
import Axios from "axios";
import { createHash } from "crypto";
import * as fs from "fs";
import humanStringify from "human-stringify";
import { Readable } from "stream";
import { CloudFunctions, cloudfunctions_v1 as gcf, initializeGoogleAPIs } from "./google";
import { log } from "./log";
import { packer } from "./packer";

export type AnyFunction = (...args: any[]) => any;

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

export interface FunctionCall {
    name: string;
    args: any[];
}

export interface FunctionReturn {
    type: "returned" | "error";
    value?: any;
}

export interface CloudifyGoogleOptions extends gcf.Schema$CloudFunction {
    region?: string;
    timeoutSec?: number;
    availableMemoryMb?: number;
}

export class CloudifyGoogle implements CloudFunctionFactory {
    protected constructor(
        protected googleCloudFunctionsApi: CloudFunctions,
        protected trampoline: string
    ) {}

    static async create(serverModule: string, options: CloudifyGoogleOptions = {}) {
        const { archive, hash: codeHash } = await packer(
            serverModule,
            "./google/trampoline"
        );
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
                codehasha: codeHash.slice(0, 32),
                codehashb: codeHash.slice(32),
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

function getConfigHash(codeHash: string, options: object) {
    const hasher = createHash("sha256");
    const nonce = `${Math.random()}`.replace(".", "");
    hasher.update(JSON.stringify({ nonce, codeHash, options }));
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

async function testPacker(serverModule: string) {
    const output = fs.createWriteStream("dist.zip");

    const { archive, hash } = await packer(serverModule, "./google/trampoline.js");
    archive.pipe(output);
    log(`hash: ${hash}`);
}

if (process.argv.length > 2 && process.argv[2] === "--test") {
    testPacker("./server");
}

export interface CloudifyAWSOptions
    extends Partial<aws.Lambda.Types.CreateFunctionRequest> {
    region?: string;
}

function zipStreamToBuffer(zipStream: Readable): Promise<Buffer> {
    const buffers: Buffer[] = [];
    return new Promise((resolve, reject) => {
        zipStream.on("data", data => buffers.push(data as Buffer));
        zipStream.on("end", () => resolve(Buffer.concat(buffers)));
        zipStream.on("error", reject);
    });
}

export class CloudifyAWS implements CloudFunctionFactory {
    protected constructor(protected lambda: aws.Lambda, protected FunctionName: string) {}

    static async create(serverModule: string, options: CloudifyAWSOptions = {}) {
        const { region = "us-east-1", ...rest } = options;
        aws.config.region = region;
        const iam = new aws.IAM();
        const lambda = new aws.Lambda({ apiVersion: "2015-03-31" });

        const policy = {
            Version: "2012-10-17",
            Statement: [
                {
                    Action: "sts:AssumeRole",
                    Principal: { AWS: "*" },
                    Effect: "Allow",
                    Sid: ""
                }
            ]
        };

        const RoleName = "cloudify-trampoline-role";
        let roleResponse;

        roleResponse = await iam
            .getRole({ RoleName })
            .promise()
            .catch(_ => {});

        if (!roleResponse) {
            const roleParams: aws.IAM.CreateRoleRequest = {
                AssumeRolePolicyDocument: JSON.stringify(policy) /* required */,
                RoleName /* required */,
                Description: "role for lambda functions created by cloudify",
                MaxSessionDuration: 3600
            };

            roleResponse = await iam.createRole(roleParams).promise();
        }

        const { archive, hash: codeHash } = await packer(
            serverModule,
            "./aws/trampoline",
            {
                packageBundling: "bundleNodeModules"
            }
        );
        log(`hash: ${codeHash}`);
        const { Tags } = options;

        const configHash = getConfigHash(codeHash, options);

        const ZipFile = await zipStreamToBuffer(archive);
        const createFunctionRequest: aws.Lambda.Types.CreateFunctionRequest = {
            FunctionName: `cloudify-${configHash.slice(0, 50)}`,
            Role: roleResponse.Role.Arn,
            Runtime: "nodejs6.10",
            Handler: "index.trampoline",
            Code: {
                ZipFile
            },
            Description: "cloudify trampoline function",
            Timeout: 60,
            MemorySize: 128,
            Tags: {
                codeHash,
                ...Tags
            },
            ...rest
        };
        validateAWSTags(createFunctionRequest.Tags);
        log(`createFunctionRequest: ${humanStringify(createFunctionRequest)}`);
        const func = await lambda.createFunction(createFunctionRequest).promise();
        log(`Created function ${func.FunctionName}`);
        if (!func.FunctionName) {
            throw new Error(`Created lambda function has no function name`);
        }
        return new CloudifyAWS(lambda, func.FunctionName);
    }

    cloudify<F extends AnyFunction>(fn: F): PromisifiedFunction<F> {
        const promisifedFunc = async (...args: any[]) => {
            let callArgs: FunctionCall = {
                name: fn.name,
                args
            };
            const callArgsStr = JSON.stringify(callArgs);
            log(`Calling cloud function "${fn.name}" with args: ${callArgsStr}`, "");

            const request: aws.Lambda.Types.InvocationRequest = {
                FunctionName: this.FunctionName,
                LogType: "Tail",
                Payload: callArgsStr
            };
            log(`Invocation request: ${humanStringify(request)}`);
            const response = await this.lambda.invoke(request).promise();
            log(`  returned: ${humanStringify(response)}`);
            if (response.FunctionError) {
                throw new Error(response.Payload as string);
            }
            let returned: FunctionReturn = JSON.parse(response.Payload as string);
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
        await this.lambda
            .deleteFunction({ FunctionName: this.FunctionName })
            .promise()
            .catch(err => log(`Cleanup failed: ${err}`));
    }
}

/**
 * The following restrictions apply to tags:
 *
 * Maximum number of tags per resource—50
 *
 * Maximum key length—128 Unicode characters in UTF-8
 *
 * Maximum value length—256 Unicode characters in UTF-8
 *
 * Tag keys and values are case sensitive.
 *
 * Do not use the aws: prefix in your tag names or values because it is reserved
 * for AWS use. You can't edit or delete tag names or values with this prefix.
 * Tags with this prefix do not count against your tags per resource limit.
 *
 * If your tagging schema will be used across multiple services and resources,
 * remember that other services may have restrictions on allowed characters.
 * Generally allowed characters are: letters, spaces, and numbers representable
 * in UTF-8, plus the following special characters: + - = . _ : / @.
 */
function validateAWSTags(tags?: object) {
    if (!tags) {
        return;
    }
    const keys = Object.keys(tags);
    if (keys.length > 50) {
        throw new Error("Cannot exceed 50 tags");
    }
    if (keys.find(key => typeof key !== "string" || typeof tags[key] !== "string")) {
        throw new Error("Tags and values must be strings");
    }
    if (keys.find(key => key.length > 128)) {
        throw new Error("Tag keys cannot exceed 128 characters");
    }
    if (keys.find(key => tags[key].length > 256)) {
        throw new Error("Tag values cannot exceed 256 characters");
    }
    if (keys.find(key => key.startsWith("aws:"))) {
        throw new Error("Tag keys beginning with 'aws:' are reserved");
    }
    const pattern = /^[a-zA-Z0-9+=._:/-]*$/;
    if (keys.find(key => !key.match(pattern) || !tags[key].match(pattern))) {
        throw new Error(
            "Tag keys and values should only contain letters, spaces, numbers, and the following characters: + - = . _ : / @"
        );
    }
}
