import { FunctionCall, FunctionReturn } from "../shared";
import * as aws from "aws-sdk";
import { SNSEvent } from "aws-lambda";
import { publishSQS, publishSQSControlMessage } from "./aws-queue";

let sqs = new aws.SQS({ apiVersion: "2012-11-05" });

type AnyFunction = (...args: any[]) => any;
const funcs: { [func: string]: AnyFunction } = {};

export function registerFunction(fn: AnyFunction, name?: string) {
    name = name || fn.name;
    if (!name) {
        throw new Error("Could not register function without name");
    }
    funcs[name] = fn;
}

export function registerAllFunctions(obj: { [name: string]: AnyFunction }) {
    for (const name of Object.keys(obj)) {
        registerFunction(obj[name], name);
    }
}

export async function trampoline(
    event: any,
    _context: any,
    callback: (err: Error | null, obj: FunctionReturn) => void
) {
    const { name, args, CallId } = event as FunctionCall;
    try {
        if (!name) {
            throw new Error("Invalid function call request: no name");
        }

        const func = funcs[name];
        if (!func) {
            throw new Error(`Function named "${name}" not found`);
        }

        if (!args) {
            throw new Error("Invalid arguments to function call");
        }

        const rv = await func.apply(undefined, args);

        callback(null, {
            type: "returned",
            value: rv,
            CallId
        });
    } catch (err) {
        const errObj = {};
        Object.getOwnPropertyNames(err).forEach(name => (errObj[name] = err[name]));
        callback(null, {
            type: "error",
            value: errObj,
            CallId
        });
    }
}

function sendError(err: any, ResponseQueueUrl: string, CallId: string) {
    console.error(err);
    sqs.sendMessage({
        QueueUrl: ResponseQueueUrl,
        MessageBody: JSON.stringify({
            type: "error",
            value: err,
            CallId
        })
    }).send();
}

export async function snsTrampoline(
    snsEvent: SNSEvent,
    context: any,
    _callback: (err: Error | null, obj: object) => void
) {
    console.log(`SNS event: ${snsEvent.Records.length} records`);
    for (const record of snsEvent.Records) {
        const event = JSON.parse(record.Sns.Message) as FunctionCall;
        const { CallId, ResponseQueueId } = event;
        const startedMessage = setTimeout(
            () =>
                publishSQSControlMessage("functionstarted", sqs, ResponseQueueId!, {
                    CallId
                }),
            2 * 1000
        );
        trampoline(event, context, (err, obj) => {
            clearTimeout(startedMessage);
            let result = obj;
            if (err) {
                sendError(err, ResponseQueueId!, CallId);
                return;
            }
            console.log(`Result: ${JSON.stringify(result)}`);
            publishSQS(sqs, ResponseQueueId!, JSON.stringify(result), { CallId }).catch(
                err => {
                    sendError(err, ResponseQueueId!, CallId);
                }
            );
        }).catch(err => sendError(err, ResponseQueueId!, CallId));
    }
}

console.log(`Successfully loaded cloudify trampoline function.`);
