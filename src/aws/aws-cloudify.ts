import * as aws from "aws-sdk";
import { createHash } from "crypto";
import humanStringify from "human-stringify";
import { Readable } from "stream";
import { AnyFunction, Response, ResponsifiedFunction } from "../cloudify";
import { log } from "../log";
import { PackerResult, packer } from "../packer";
import { FunctionCall, FunctionReturn, getConfigHash } from "../shared";

export interface Options {
    region?: string;
    PolicyArn?: string;
    awsLambdaOptions?: Partial<aws.Lambda.Types.CreateFunctionRequest>;
}

export interface AWSVariables {
    readonly FunctionName: string;
    readonly RoleName: string;
    readonly logGroupName: string;
    readonly region: string;
}

export interface AWSServices {
    readonly lambda: aws.Lambda;
    readonly cloudwatch: aws.CloudWatchLogs;
    readonly iam: aws.IAM;
}

export const name = "aws";

export type State = AWSVariables & AWSServices;

interface HasPromise<T> {
    promise(): Promise<T>;
}

function carefully<U>(arg: HasPromise<U>) {
    return arg.promise().catch(log);
}

function quietly<U>(arg: HasPromise<U>) {
    return arg.promise().catch(_ => {});
}

function zipStreamToBuffer(zipStream: Readable): Promise<Buffer> {
    const buffers: Buffer[] = [];
    return new Promise((resolve, reject) => {
        zipStream.on("data", data => buffers.push(data as Buffer));
        zipStream.on("end", () => resolve(Buffer.concat(buffers)));
        zipStream.on("error", reject);
    });
}

function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

let defaults = {
    region: "us-east-1",
    PolicyArn: "arn:aws:iam::aws:policy/AdministratorAccess",
    Timeout: 60,
    MemorySize: 128
};

function createAWSApis(region: string) {
    return {
        iam: new aws.IAM({ apiVersion: "2010-05-08", region }),
        lambda: new aws.Lambda({ apiVersion: "2015-03-31", region }),
        cloudwatch: new aws.CloudWatchLogs({ apiVersion: "2014-03-28", region })
    };
}

export async function initialize(
    serverModule: string,
    options: Options = {}
): Promise<State> {
    const {
        region = defaults.region,
        PolicyArn = defaults.PolicyArn,
        awsLambdaOptions = {}
    } = options;
    const { lambda, iam, cloudwatch } = createAWSApis(region);

    const RoleName = "cloudify-trampoline-role";
    // XXX Make the role specific to this lambda using the configHash? That
    // would ensure separation.

    async function createRole() {
        log(`Creating role "${RoleName}" for cloudify trampoline function`);
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
        let roleResponse = await iam.createRole(roleParams).promise();
        await iam
            .attachRolePolicy({ RoleName: roleResponse.Role.RoleName, PolicyArn })
            .promise();
        return roleResponse;
    }

    async function checkRoleReadiness(Role: aws.IAM.Role) {
        log(`Creating test function to ensure new role is ready for use`);
        const { archive } = await packer({
            trampolineModule: require.resolve("./aws-trampoline"),
            packageBundling: "bundleNodeModules",
            webpackOptions: { externals: "aws-sdk" }
        });
        const nonce = createHash("sha256")
            .update(`${Math.random()}`)
            .digest("hex")
            .slice(0, 16);
        const FunctionName = `cloudify-testfunction-${nonce}`;
        const createFunctionRequest: aws.Lambda.Types.CreateFunctionRequest = {
            FunctionName,
            Role: Role.Arn,
            Runtime: "nodejs6.10",
            Handler: "index.trampoline",
            Code: { ZipFile: await zipStreamToBuffer(archive) }
        };
        let testfunc: aws.Lambda.FunctionConfiguration | void;
        await sleep(2000);
        for (let i = 0; i < 100; i++) {
            log(`Polling for role readiness...`);
            testfunc = await quietly(lambda.createFunction(createFunctionRequest));
            if (testfunc) {
                break;
            }
            await sleep(1000);
        }
        if (!testfunc) {
            throw new Error("Could not initialize lambda execution role");
        }
        log(`Role ready. Cleaning up.`);
        await quietly(lambda.deleteFunction({ FunctionName }));
        return roleResponse;
    }

    async function createFunction(Role: aws.IAM.Role) {
        const { archive, hash: codeHash } = await pack(serverModule);
        log(`codeHash: ${codeHash}`);
        const { Tags } = awsLambdaOptions;
        const configHash = getConfigHash(codeHash, options);
        const FunctionName = `cloudify-${configHash.slice(0, 55)}`;
        const previous = await quietly(lambda.getFunction({ FunctionName }));
        if (previous) {
            throw new Error("Function name hash collision");
        }
        const createFunctionRequest: aws.Lambda.Types.CreateFunctionRequest = {
            FunctionName,
            Role: Role.Arn,
            Runtime: "nodejs6.10",
            Handler: "index.trampoline",
            Code: { ZipFile: await zipStreamToBuffer(archive) },
            Description: "cloudify trampoline function",
            Timeout: defaults.Timeout,
            MemorySize: defaults.MemorySize,
            Tags: { configHash, ...Tags },
            ...awsLambdaOptions
        };
        log(`createFunctionRequest: ${humanStringify(createFunctionRequest)}`);
        const func = await lambda.createFunction(createFunctionRequest).promise();
        log(`Created function ${func.FunctionName}`);
        if (!func.FunctionName) {
            throw new Error(`Created lambda function has no function name`);
        }
        return FunctionName;
    }

    let roleResponse = await quietly(iam.getRole({ RoleName }));
    if (!roleResponse) {
        roleResponse = await createRole();
        await checkRoleReadiness(roleResponse.Role);
    }
    const FunctionName = await createFunction(roleResponse.Role);
    const logGroupName = `/aws/lambda/${FunctionName}`;
    // prettier-ignore
    return { FunctionName, RoleName, logGroupName, region, lambda, cloudwatch, iam};
}

export function cloudifyWithResponse<F extends AnyFunction>(
    state: State,
    fn: F
): ResponsifiedFunction<F> {
    const responsifedFunc = async (...args: any[]) => {
        let callArgs: FunctionCall = {
            name: fn.name,
            args
        };
        const callArgsStr = JSON.stringify(callArgs);
        log(`Calling cloud function "${fn.name}" with args: ${callArgsStr}`, "");
        const request: aws.Lambda.Types.InvocationRequest = {
            FunctionName: state.FunctionName,
            LogType: "Tail",
            Payload: callArgsStr
        };
        log(`Invocation request: ${humanStringify(request)}`);
        const rawResponse = await state.lambda.invoke(request).promise();
        log(`  returned: ${humanStringify(rawResponse)}`);
        let error: Error | undefined;
        if (rawResponse.FunctionError) {
            if (rawResponse.LogResult) {
                log(Buffer.from(rawResponse.LogResult!, "base64").toString());
            }
            error = new Error(rawResponse.Payload as string);
        }
        let returned: FunctionReturn | undefined;
        returned =
            !error && rawResponse.Payload && JSON.parse(rawResponse.Payload as string);
        if (returned && returned.type === "error") {
            const errValue = returned.value;
            error = new Error(errValue.message);
            error.name = errValue.name;
            error.stack = errValue.stack;
        }
        const value = !error && returned && returned.value;

        let rv: Response<ReturnType<F>> = { value, error, rawResponse };
        return rv;
    };
    return responsifedFunc as any;
}

async function deleteRole(RoleName: string, iam: aws.IAM) {
    const policies = await carefully(iam.listAttachedRolePolicies({ RoleName }));
    const AttachedPolicies = (policies && policies.AttachedPolicies) || [];
    function detach(policy: aws.IAM.AttachedPolicy) {
        const PolicyArn = policy.PolicyArn!;
        return carefully(iam.detachRolePolicy({ RoleName, PolicyArn }));
    }
    await Promise.all(AttachedPolicies.map(detach)).catch(log);
    await carefully(iam.deleteRole({ RoleName }));
}

export async function cleanup(state: State) {
    const { FunctionName, RoleName, logGroupName, cloudwatch, iam, lambda } = state;

    log(`Deleting log group: ${logGroupName}`);
    await carefully(cloudwatch.deleteLogGroup({ logGroupName }));

    log(`Deleting role name: ${RoleName}`);
    await deleteRole(RoleName, iam);

    log(`Deleting function: ${FunctionName}`);
    await carefully(lambda.deleteFunction({ FunctionName }));
}

export async function pack(functionModule: string): Promise<PackerResult> {
    return packer({
        trampolineModule: require.resolve("./aws-trampoline"),
        functionModule,
        packageBundling: "bundleNodeModules",
        webpackOptions: { externals: "aws-sdk" }
    });
}
