import { Request, Response } from "express";
import humanStringify from "human-stringify";
import { FunctionCall, FunctionReturn } from "../shared";
import { AnyFunction } from "../type-helpers";
import { cloudfunctions_v1beta2, google, pubsub_v1, GoogleApis } from "googleapis";
import PubSubApi = pubsub_v1;
import * as cloudqueue from "../queue";
import CloudFunctions = cloudfunctions_v1beta2;
import { publish } from "./google-queue";

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

interface ParsedFunc {
    func: AnyFunction;
    args: any[];
    CallId: string;
    ResponseQueueId?: string;
}

function parseFunc(body: object): ParsedFunc {
    const { name, args, CallId, ResponseQueueId } = body as FunctionCall;
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

    console.log(`func: ${name}, args: ${humanStringify(args)}`);
    return { func, args, CallId, ResponseQueueId };
}

function createErrorResponse(err: Error, CallId: string | undefined): FunctionReturn {
    const errObj = {};
    Object.getOwnPropertyNames(err).forEach(name => (errObj[name] = err[name]));
    return {
        type: "error",
        value: errObj,
        CallId: CallId || ""
    };
}

async function callFunc(parsedFunc: ParsedFunc) {
    const { func, args, CallId } = parsedFunc;
    const returned = await func.apply(undefined, args);
    const rv: FunctionReturn = {
        type: "returned",
        value: returned,
        CallId
    };
    return rv;
}

export async function trampoline(request: Request, response: Response) {
    let CallId: string | undefined;
    try {
        const parsedFunc = parseFunc(request.body);
        CallId = parsedFunc.CallId;
        const returned = await callFunc(parsedFunc);
        response.send(returned);
    } catch (err) {
        response.send(createErrorResponse(err, CallId));
    }
}

interface CloudFunctionContext {
    eventId: string;
    timestamp: string;
    eventType: string;
    resource: object;
}

interface CloudFunctionPubSubEvent {
    data: PubSubApi.Schema$PubsubMessage;
    context: CloudFunctionContext;
}

const pubsub = google.pubsub("v1");

export async function pubsubTrampoline(event: CloudFunctionPubSubEvent): Promise<void> {
    let CallId: string = "";
    let ResponseQueueId: string | undefined;
    try {
        const parsedFunc = parseFunc(JSON.parse(event.data.data!));
        ({ CallId, ResponseQueueId } = parsedFunc);
        const returned = await callFunc(parsedFunc);
        await publish(pubsub, ResponseQueueId!, JSON.stringify(returned), { CallId });
    } catch (err) {
        if (ResponseQueueId) {
            const response = createErrorResponse(err, CallId);
            await publish(pubsub, ResponseQueueId!, JSON.stringify(response), { CallId });
        } else {
            console.error(err);
        }
    }
}
