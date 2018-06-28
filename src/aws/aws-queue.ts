import * as aws from "aws-sdk";
import * as cloudqueue from "../queue";
import { FunctionCall, sleep, Mutable } from "../shared";
import { carefully, quietly, AWSServices, deleteRole } from "./aws-cloudify";
import { log } from "../log";
import { pollAWSRequest } from "./aws-shared";
import { AnyFunction } from "../cloudify";
import { Omit, NonFunctionProperties, PartialRequire } from "../type-helpers";

export interface AWSFunctionQueue {
    readonly sqs: aws.SQS;
    readonly sns: aws.SNS;
    readonly iam: aws.IAM;
    readonly ResponseQueueUrl: string;
    readonly RequestTopicArn: string;
    readonly SNSFeedbackRole: string;
    readonly SNSLambdaSubscriptionArn: string;
    readonly rolePolicy: string;
}

function sqsMessageAttribute(message: aws.SQS.Message, attr: string) {
    const a = message.MessageAttributes;
    if (!a) {
        return undefined;
    }
    return a[attr] && a[attr].StringValue;
}

export function createControlMessage(
    QueueUrl: string,
    attrs: cloudqueue.Attributes
): aws.SQS.SendMessageRequest {
    const attributes: aws.SQS.MessageBodyAttributeMap = {};
    Object.keys(attrs).forEach(key => {
        attributes[key] = { DataType: "String", StringValue: attrs[key] };
    });
    return {
        QueueUrl,
        MessageBody: "empty",
        MessageAttributes: {
            ...attributes
        }
    };
}

export function sendFunctionStartedMessage(
    QueueUrl: string,
    CallId: string,
    sqs: aws.SQS
) {
    const message = createControlMessage(QueueUrl, { CallId, cloudify: "started" });
    return sqs.sendMessage(message);
}

type AWSFunctionQueueVars = NonFunctionProperties<AWSFunctionQueue>;
type PartialState = PartialRequire<AWSFunctionQueueVars, "sqs" | "sns" | "iam">;

async function initialize(
    services: AWSServices,
    FunctionName: string,
    FunctionArn: string,
    rolePolicy: string
) {
    const { iam, sqs, sns, lambda } = services;

    let rv: Partial<Mutable<AWSFunctionQueue>> = { sqs, sns, iam };
    rv.rolePolicy = rolePolicy;

    rv.SNSFeedbackRole = "cloudify-cached-SNSFeedbackRole";
    if (rolePolicy === "createTemporaryRole") {
        rv.SNSFeedbackRole = `${FunctionName}-SNSRole`;
    }
    const snsRole = await createSNSFeedbackRole(rv.SNSFeedbackRole, iam);
    rv.SNSFeedbackRole = snsRole.Role.RoleName;
    rv.RequestTopicArn = await createSNSNotifier(
        `${FunctionName}-Requests`,
        snsRole.Role.Arn,
        sns
    );
    rv.ResponseQueueUrl = await createSQSQueue(`${FunctionName}-Responses`, 60, sqs);

    const addPermissionResponse = await addSnsInvokePermissionsToFunction(
        FunctionName,
        rv.RequestTopicArn!,
        lambda
    );
    const snsRepsonse = await sns
        .subscribe({
            TopicArn: rv.RequestTopicArn,
            Protocol: "lambda",
            Endpoint: FunctionArn
        })
        .promise();
    log(`Created SNS subscription: ${snsRepsonse.SubscriptionArn}`);
    rv.SNSLambdaSubscriptionArn = snsRepsonse.SubscriptionArn!;
    startResultCollectorIfNeeded(rv);
    startRetryTimer(rv);
    return rv;
}

async function cleanup(arg: PartialState) {
    const stopPromise = stop(arg);
    let {
        sqs,
        sns,
        iam,
        ResponseQueueUrl,
        RequestTopicArn,
        SNSFeedbackRole,
        SNSLambdaSubscriptionArn,
        rolePolicy,
        ...rest
    } = arg;
    const _exhaustiveCheck: Required<typeof rest> = {};

    if (SNSLambdaSubscriptionArn) {
        log(`Deleting request queue subscription to lambda`);
        await quietly(sns.unsubscribe({ SubscriptionArn: SNSLambdaSubscriptionArn }));
    }

    if (SNSFeedbackRole && rolePolicy === "createTemporaryRole") {
        log(`Deleting SNS feedback role: ${SNSFeedbackRole}`);
        await deleteRole(SNSFeedbackRole, iam);
    }
    if (RequestTopicArn) {
        log(`Deleting request queue topic: ${RequestTopicArn}`);
        await quietly(sns.deleteTopic({ TopicArn: RequestTopicArn }));
    }
    if (ResponseQueueUrl) {
        log(`Deleting response queue: ${ResponseQueueUrl}`);
        await quietly(sqs.deleteQueue({ QueueUrl: ResponseQueueUrl }));
    }
    await stopPromise;
}

function publish(state: AWSFunctionQueue, call: FunctionCall): void {
    carefully(
        state.sns.publish({
            TopicArn: state.RequestTopicArn,
            Message: JSON.stringify(call)
        })
    );
}

function isStopQueueMessage(message: aws.SQS.Message): boolean {
    return sqsMessageAttribute(message, "cloudify") === "stop";
}

function isStartedFunctionCallMessage(message: aws.SQS.Message): boolean {
    return sqsMessageAttribute(message, "cloudify") === "started";
}

function sendStopQueueMessage(state: AWSFunctionQueue): Promise<any> {
    const { sqs, ResponseQueueUrl } = state;
    const message = createControlMessage(state.ResponseQueueUrl, { cloudify: "stop" });
    return sqs.sendMessage(message).promise();
}

async function receiveMessages(state: AWSFunctionQueue): Promise<aws.SQS.Message[]> {
    const { ResponseQueueUrl, sqs } = state;
    const response = await sqs
        .receiveMessage({
            QueueUrl: state.ResponseQueueUrl,
            WaitTimeSeconds: 20,
            MaxNumberOfMessages: 10,
            MessageAttributeNames: ["All"]
        })
        .promise();
    const { Messages = [] } = response;
    if (Messages.length > 0) {
        carefully(
            sqs.deleteMessageBatch({
                QueueUrl: state.ResponseQueueUrl,
                Entries: Messages.map(m => ({
                    Id: m.MessageId!,
                    ReceiptHandle: m.ReceiptHandle!
                }))
            })
        );
    }
    return Messages;
}

function description(state: AWSFunctionQueue) {
    return state.ResponseQueueUrl;
}

function getMessageBody(message: aws.SQS.Message): string {
    return message.Body || "";
}

function getCallId(message: aws.SQS.Message): string {
    return sqsMessageAttribute(message, "CallId") || "";
}

// XXX The log group created by SNS doesn't have a programmatic API to get the name. Skip?
// Try testing with limited function concurrency to see what errors are generated.
async function createSNSNotifier(Name: string, RoleArn: string, sns: aws.SNS) {
    log(`Creating SNS notifier`);
    const topic = await sns.createTopic({ Name }).promise();
    const TopicArn = topic.TopicArn!;
    log(`Created SNS notifier with TopicArn: ${TopicArn}`);
    let success = await pollAWSRequest(
        100,
        "role for SNS invocation of lambda function failure feedback",
        () =>
            sns.setTopicAttributes({
                TopicArn,
                AttributeName: "LambdaFailureFeedbackRoleArn",
                AttributeValue: RoleArn
            })
    );

    if (!success) {
        throw new Error("Could not initialize lambda execution role");
    }

    return TopicArn!;
}

async function createSNSFeedbackRole(RoleName: string, iam: aws.IAM) {
    const previousRole = await quietly(iam.getRole({ RoleName }));
    if (previousRole) {
        return previousRole;
    }
    log(`Creating role "${RoleName}" for SNS failure feedback`);
    const AssumeRolePolicyDocument = JSON.stringify({
        Version: "2012-10-17",
        Statement: [
            {
                Principal: { Service: "sns.amazonaws.com" },
                Action: "sts:AssumeRole",
                Effect: "Allow"
            }
        ]
    });
    const roleParams: aws.IAM.CreateRoleRequest = {
        AssumeRolePolicyDocument,
        RoleName,
        Description: "role for SNS failures created by cloudify",
        MaxSessionDuration: 36000
    };
    const roleResponse = await iam.createRole(roleParams).promise();
    log(`Putting SNS role policy`);
    const PolicyArn = "arn:aws:iam::aws:policy/service-role/AmazonSNSRole";
    await iam.attachRolePolicy({ RoleName, PolicyArn }).promise();
    return roleResponse;
}

function addSnsInvokePermissionsToFunction(
    FunctionName: string,
    RequestTopicArn: string,
    lambda: aws.Lambda
) {
    return lambda
        .addPermission({
            FunctionName,
            Action: "lambda:invokeFunction",
            Principal: "sns.amazonaws.com",
            StatementId: `${FunctionName}-Invoke`,
            SourceArn: RequestTopicArn
        })
        .promise();
}

async function createSQSQueue(
    QueueName: string,
    VTimeout: number,
    sqs: aws.SQS,
    deadLetterTargetArn?: string
) {
    const createQueueRequest: aws.SQS.CreateQueueRequest = {
        QueueName,
        Attributes: {
            VisibilityTimeout: `${VTimeout}`
        }
    };
    if (deadLetterTargetArn) {
        createQueueRequest.Attributes!.RedrivePolicy = JSON.stringify({
            maxReceiveCount: "5",
            deadLetterTargetArn
        });
    }
    const response = await sqs.createQueue(createQueueRequest).promise();
    return response.QueueUrl!;
}
