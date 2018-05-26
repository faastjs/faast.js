import * as aws from "aws-sdk";
import { createHash } from "crypto";
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
import { SelfDestructorOptions } from "./aws-self-destructor";

function zipStreamToBuffer(zipStream: Readable): Promise<Buffer> {
    const buffers: Buffer[] = [];
    return new Promise((resolve, reject) => {
        zipStream.on("data", data => buffers.push(data as Buffer));
        zipStream.on("end", () => resolve(Buffer.concat(buffers)));
        zipStream.on("error", reject);
    });
}

export interface CloudifyAWSOptions {
    region?: string;
    PolicyArn?: string;
    cacheRole?: boolean;
    awsLambdaOptions?: Partial<aws.Lambda.Types.CreateFunctionRequest>;
}

export async function packAWSLambdaFunction(
    functionModule: string
): Promise<PackerResult> {
    return packer({
        trampolineModule: require.resolve("./aws-trampoline"),
        functionModule,
        packageBundling: "bundleNodeModules",
        webpackOptions: { externals: "aws-sdk" }
    });
}

function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function shash(str: string) {
    const hasher = createHash("sha256");
    hasher.update(str);
    return hasher.digest("hex");
}

export class CloudifyAWS implements CloudFunctionService {
    name = "aws";

    protected constructor(
        protected lambda: aws.Lambda,
        protected FunctionName: string,
        protected cloudwatch: aws.CloudWatchLogs,
        protected iam: aws.IAM,
        protected RoleName: string
    ) {}

    static async create(serverModule: string, options: CloudifyAWSOptions = {}) {
        const {
            region = "us-east-1",
            PolicyArn = "arn:aws:iam::aws:policy/AdministratorAccess",
            cacheRole = true,
            awsLambdaOptions = {}
        } = options;
        aws.config.region = region;
        const iam = new aws.IAM();
        const lambda = new aws.Lambda({ apiVersion: "2015-03-31" });
        const cloudwatch = new aws.CloudWatchLogs({ apiVersion: "2014-03-28" });

        const RoleName = "cloudify-trampoline-role";
        // XXX Make the role specific to this lambda using the configHash? That
        // would ensure separation.

        let roleResponse = await iam
            .getRole({ RoleName })
            .promise()
            .catch(_ => {});

        if (!roleResponse) {
            const AssumeRolePolicyDocument = JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Principal: { Service: "lambda.amazonaws.com" },
                        Action: "sts:AssumeRole",
                        Effect: "Allow"
                    }
                ]
            });

            const roleParams: aws.IAM.CreateRoleRequest = {
                AssumeRolePolicyDocument,
                RoleName,
                Description: "role for lambda functions created by cloudify",
                MaxSessionDuration: 3600
            };

            log(`Creating role "${RoleName}" for cloudify trampoline function`);

            roleResponse = await iam.createRole(roleParams).promise();

            await iam
                .attachRolePolicy({
                    RoleName: roleResponse.Role.RoleName,
                    PolicyArn
                })
                .promise();

            log(`Creating test function to ensure new role is ready for use`);

            const { archive } = await packer({
                trampolineModule: require.resolve("./aws-self-destructor"),
                trampolineFunction: "selfDestructor",
                packageBundling: "bundleNodeModules",
                webpackOptions: { externals: "aws-sdk" }
            });
            const ZipFile = await zipStreamToBuffer(archive);

            const nonce = shash(`${Math.random()}`).slice(0, 16);
            const FunctionName = `cloudify-testfunction-${nonce}`;
            const logGroupName = `/aws/lambda/${FunctionName}`;

            const createFunctionRequest: aws.Lambda.Types.CreateFunctionRequest = {
                FunctionName,
                Role: roleResponse.Role.Arn,
                Runtime: "nodejs6.10",
                Handler: "index.trampoline",
                Code: {
                    ZipFile
                }
            };

            let testfunc: aws.Lambda.FunctionConfiguration | undefined;
            await sleep(2000);
            for (let i = 0; i < 100; i++) {
                try {
                    log(`Polling for role readiness...`);
                    testfunc = await lambda
                        .createFunction(createFunctionRequest)
                        .promise();
                    break;
                } catch (err) {
                    log(`Role not ready (${err.message})`);
                }
                await sleep(1000);
            }

            if (!testfunc) {
                throw new Error("Could not initialize lambda execution role");
            }

            log(`Role ready. Invoking function.`);
            const args: SelfDestructorOptions = { keepRole: true };
            await lambda
                .invoke({ FunctionName, Payload: JSON.stringify(args) })
                .promise()
                .catch(err => log(err));
            log(`Done invoking function`);
        }

        const { archive, hash: codeHash } = await packAWSLambdaFunction(serverModule);
        log(`codeHash: ${codeHash}`);
        const { Tags } = awsLambdaOptions;

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
            ...awsLambdaOptions
        };
        log(`createFunctionRequest: ${humanStringify(createFunctionRequest)}`);
        const func = await lambda.createFunction(createFunctionRequest).promise();
        log(`Created function ${func.FunctionName}`);
        if (!func.FunctionName) {
            throw new Error(`Created lambda function has no function name`);
        }
        return new CloudifyAWS(lambda, func.FunctionName, cloudwatch, iam, RoleName);
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
                const errValue = returned.value;
                let err = new Error(errValue.message);
                err.name = errValue.name;
                err.stack = errValue.stack;
                throw err;
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
        await this.cloudwatch
            .deleteLogGroup({
                logGroupName: `/aws/lambda/${this.FunctionName}`
            })
            .promise();
        const { RoleName } = this;
        log(`Deleting role name: ${RoleName}`);
        // 1. Why is the Log Group still there after deletion?
        // 2. How to remove the role completely.
        if (RoleName) {
            const { AttachedPolicies = [] } = await this.iam
                .listAttachedRolePolicies({ RoleName })
                .promise();

            await Promise.all(
                AttachedPolicies.map(policy =>
                    this.iam
                        .detachRolePolicy({
                            RoleName,
                            PolicyArn: policy.PolicyArn!
                        })
                        .promise()
                )
            );

            await this.iam.deleteRole({ RoleName }).promise();
        }
        await this.lambda
            .deleteFunction({ FunctionName: this.FunctionName })
            .promise()
            .catch(err => log(`Delete function failed: ${err}`));
    }
}
