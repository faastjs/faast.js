import * as aws from "aws-sdk";
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
import { packer } from "../packer";

function zipStreamToBuffer(zipStream: Readable): Promise<Buffer> {
    const buffers: Buffer[] = [];
    return new Promise((resolve, reject) => {
        zipStream.on("data", data => buffers.push(data as Buffer));
        zipStream.on("end", () => resolve(Buffer.concat(buffers)));
        zipStream.on("error", reject);
    });
}

export interface CloudifyAWSOptions
    extends Partial<aws.Lambda.Types.CreateFunctionRequest> {
    region?: string;
}

export async function packAWSLambdaFunction(serverModule: string) {
    return packer(serverModule, "./aws/trampoline", {
        packageBundling: "bundleNodeModules",
        webpackOptions: { externals: "aws-sdk" }
    });
}

export class CloudifyAWS implements CloudFunctionService {
    name = "aws";

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

        const { archive, hash: codeHash } = await packAWSLambdaFunction(serverModule);
        log(`codeHash: ${codeHash}`);
        const { Tags } = options;

        const configHash = getConfigHash(codeHash, options);

        const FunctionName = `cloudify-${configHash.slice(0, 55)}`;
        const previous = await lambda
            .getFunction({ FunctionName })
            .promise()
            .catch(_ => undefined);
        if (previous) {
            throw new Error("Function name hash collission");
        }

        const ZipFile = await zipStreamToBuffer(archive);
        const createFunctionRequest: aws.Lambda.Types.CreateFunctionRequest = {
            FunctionName,
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
                configHash,
                ...Tags
            },
            ...rest
        };
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
