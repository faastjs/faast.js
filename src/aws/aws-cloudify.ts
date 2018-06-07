import * as aws from "aws-sdk";
import { AWSError, Request } from "aws-sdk";
import humanStringify from "human-stringify";
import { Readable } from "stream";
import * as uuidv4 from "uuid/v4";
import { AnyFunction, Response, ResponsifiedFunction } from "../cloudify";
import { log } from "../log";
import { PackerResult, packer } from "../packer";
import { FunctionCall, FunctionReturn } from "../shared";

export type RoleHandling = "createTemporaryRole" | "createOrReuseCachedRole";

export interface Options {
    region?: string;
    PolicyArn?: string;
    rolePolicy?: RoleHandling;
    RoleName?: string;
    timeout?: number;
    memorySize?: number;
    awsLambdaOptions?: Partial<aws.Lambda.Types.CreateFunctionRequest>;
}

export interface AWSVariables {
    readonly FunctionName: string;
    readonly RoleName: string;
    readonly QueueUrl: string;
    readonly QueueName: string;
    readonly rolePolicy: RoleHandling;
    readonly logGroupName: string;
    readonly region: string;
    readonly noCreateLogGroupPolicy: string;
}

type MutablePartial<T> = { -readonly [P in keyof T]+?: T[P] }; // Remove readonly and add ?

export interface AWSServices {
    readonly lambda: aws.Lambda;
    readonly cloudwatch: aws.CloudWatchLogs;
    readonly iam: aws.IAM;
    readonly sqs: aws.SQS;
}

export const name: string = "aws";

export interface State {
    vars: AWSVariables;
    services: AWSServices;
}

export function carefully<U>(arg: Request<U, AWSError>) {
    return arg.promise().catch(err => log(err));
}

export function quietly<U>(arg: Request<U, AWSError>) {
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

let defaults: Required<Options> = {
    region: "us-east-1",
    PolicyArn: "arn:aws:iam::aws:policy/AdministratorAccess",
    rolePolicy: "createOrReuseCachedRole",
    RoleName: "cloudify-cached-role",
    timeout: 60,
    memorySize: 128,
    awsLambdaOptions: {}
};

function createAWSApis(region: string): AWSServices {
    return {
        iam: new aws.IAM({ apiVersion: "2010-05-08", region }),
        lambda: new aws.Lambda({ apiVersion: "2015-03-31", region }),
        cloudwatch: new aws.CloudWatchLogs({ apiVersion: "2014-03-28", region }),
        sqs: new aws.SQS({ apiVersion: "2012-11-05" })
    };
}

export async function initialize(
    serverModule: string,
    options: Options = {}
): Promise<State> {
    const nonce = uuidv4();
    log(`Nonce: ${nonce}`);

    let {
        region = defaults.region,
        PolicyArn = defaults.PolicyArn,
        rolePolicy = defaults.rolePolicy,
        RoleName = defaults.RoleName,
        timeout: Timeout = defaults.timeout,
        memorySize: MemorySize = defaults.memorySize,
        awsLambdaOptions = {},
        ...rest
    } = options;
    const { lambda, iam, cloudwatch, sqs } = createAWSApis(region);

    const limits = await carefully(lambda.getAccountSettings());
    log(`Limits: ${humanStringify(limits)}`);

    if (rolePolicy === "createTemporaryRole") {
        RoleName = `cloudify-role-${nonce}`;
    }
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
        let roleResponse = await carefully(iam.createRole(roleParams));
        if (!roleResponse) {
            return undefined;
        }
        await carefully(iam.attachRolePolicy({ RoleName, PolicyArn }));
        await checkRoleReadiness(roleResponse.Role);
        return roleResponse;
    }

    async function addNoCreateLogPolicyToRole() {
        log(`Adding inline policy to not allow log group creation to role "${RoleName}"`);
        const NoCreateLogGroupPolicy = JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Resource: "*",
                    Action: "logs:CreateLogGroup",
                    Effect: "Deny"
                }
            ]
        });

        const PolicyName = `cloudify-deny-create-log-group-policy`;

        await carefully(
            iam.putRolePolicy({
                RoleName,
                PolicyName,
                PolicyDocument: NoCreateLogGroupPolicy
            })
        );

        return PolicyName;
    }

    async function checkRoleReadiness(Role: aws.IAM.Role) {
        log(`Creating test function to ensure new role is ready for use`);
        const { archive } = await packer({
            trampolineModule: require.resolve("./aws-trampoline"),
            packageBundling: "bundleNodeModules",
            webpackOptions: { externals: "aws-sdk" }
        });
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
            log("Could not initialize lambda execution role");
            return false;
        }
        log(`Role ready. Cleaning up.`);
        await carefully(lambda.deleteFunction({ FunctionName }));
        return true;
    }

    async function createFunction(Role: aws.IAM.Role) {
        const { archive } = await pack(serverModule);
        const FunctionName = `cloudify-${nonce}`;
        const previous = await quietly(lambda.getFunction({ FunctionName }));
        if (previous) {
            log("Function name hash collision");
            return undefined;
        }
        const createFunctionRequest: aws.Lambda.Types.CreateFunctionRequest = {
            FunctionName,
            Role: Role.Arn,
            Runtime: "nodejs6.10",
            Handler: "index.trampoline",
            Code: { ZipFile: await zipStreamToBuffer(archive) },
            Description: "cloudify trampoline function",
            Timeout,
            MemorySize,
            ...rest,
            ...awsLambdaOptions
        };
        log(`createFunctionRequest: ${humanStringify(createFunctionRequest)}`);
        const func = await carefully(lambda.createFunction(createFunctionRequest));
        if (func) {
            log(`Created function ${func.FunctionName}`);
            return FunctionName;
        }
        return undefined;
    }

    function createQueue(QueueName: string) {
        return carefully(
            sqs.createQueue({
                QueueName,
                Attributes: { VisibilityTimeout: `${Timeout}` }
            })
        );
        // XXX Need to set the VisibilityTimeout when the message is being processed but not finished yet.
    }

    let roleResponse = (await quietly(iam.getRole({ RoleName }))) || (await createRole());
    if (!roleResponse) {
        throw new Error(`Could not create role ${RoleName}`);
    }
    const FunctionName = await createFunction(roleResponse.Role);
    if (!FunctionName) {
        throw new Error(`Could not create lambda function ${FunctionName}`);
    }
    const logGroupName = `/aws/lambda/${FunctionName}`;
    await carefully(cloudwatch.createLogGroup({ logGroupName }));
    await carefully(cloudwatch.putRetentionPolicy({ logGroupName, retentionInDays: 1 }));
    const noCreateLogGroupPolicy = await addNoCreateLogPolicyToRole();
    const QueueName = FunctionName;
    const queueResponse = await createQueue(QueueName);
    const QueueUrl = queueResponse && queueResponse.QueueUrl;
    if (!QueueUrl) {
        throw new Error(`Could not create SQS queue: ${FunctionName}`);
    }
    return {
        vars: {
            FunctionName,
            RoleName,
            QueueUrl,
            QueueName,
            rolePolicy,
            logGroupName,
            region,
            noCreateLogGroupPolicy
        },
        services: {
            lambda,
            cloudwatch,
            iam,
            sqs
        }
    };
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
            FunctionName: state.vars.FunctionName,
            LogType: "Tail",
            Payload: callArgsStr
        };
        log(`Invocation request: ${humanStringify(request)}`);
        const rawResponse = await state.services.lambda.invoke(request).promise();
        log(`  returned: ${humanStringify(rawResponse)}`);
        log(`  requestId: ${rawResponse.$response.requestId}`);
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

export async function deleteRole(
    RoleName: string,
    noCreateLogGroupPolicy: string | undefined,
    iam: aws.IAM
) {
    const policies = await carefully(iam.listAttachedRolePolicies({ RoleName }));
    const AttachedPolicies = (policies && policies.AttachedPolicies) || [];
    function detach(policy: aws.IAM.AttachedPolicy) {
        const PolicyArn = policy.PolicyArn!;
        return carefully(iam.detachRolePolicy({ RoleName, PolicyArn }));
    }
    await Promise.all(AttachedPolicies.map(detach)).catch(log);
    if (noCreateLogGroupPolicy) {
        await carefully(
            iam.deleteRolePolicy({ RoleName, PolicyName: noCreateLogGroupPolicy })
        );
    }
    await carefully(iam.deleteRole({ RoleName }));
}

export async function cleanup(state: State) {
    const { FunctionName, RoleName, logGroupName, rolePolicy, QueueUrl } = state.vars;
    const { cloudwatch, iam, lambda, sqs } = state.services;

    if (QueueUrl) {
        log(`Deleting SQS queue: ${QueueUrl}`);
        await carefully(sqs.deleteQueue({ QueueUrl }));
    }

    if (FunctionName) {
        log(`Deleting function: ${FunctionName}`);
        await carefully(lambda.deleteFunction({ FunctionName }));
    }

    if (RoleName && rolePolicy === "createTemporaryRole") {
        log(`Deleting temporary role: ${RoleName}`);
        await deleteRole(RoleName, state.vars.noCreateLogGroupPolicy, iam);
    }

    if (logGroupName) {
        log(`Deleting log group: ${logGroupName}`);
        await carefully(cloudwatch.deleteLogGroup({ logGroupName }));
    }
}

export async function pack(functionModule: string): Promise<PackerResult> {
    return packer({
        trampolineModule: require.resolve("./aws-trampoline"),
        functionModule,
        packageBundling: "bundleNodeModules",
        webpackOptions: { externals: "aws-sdk" }
    });
}

export function getResourceList(state: State) {
    return JSON.stringify(state.vars);
}

export function cleanupResources(resources: string) {
    const vars: AWSVariables = JSON.parse(resources);
    if (!vars.region) {
        throw new Error("Resources missing 'region'");
    }
    const services = createAWSApis(vars.region);
    return cleanup({ vars, services });
}
