import { Request, Response } from "express";
import { google, pubsub_v1 } from "googleapis";
import { FunctionCall, FunctionReturn } from "../shared";
import { AnyFunction } from "../type-helpers";
import { publish } from "./google-queue";
import PubSubApi = pubsub_v1;

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
    return { func, args, CallId, ResponseQueueId };
}

function createErrorResponse(
    err: Error,
    CallId: string | undefined,
    executionStart: number
): FunctionReturn {
    const errObj = {};
    Object.getOwnPropertyNames(err).forEach(name => {
        if (typeof err[name] === "string") {
            errObj[name] = err[name];
        }
    });
    return {
        type: "error",
        value: errObj,
        CallId: CallId || "",
        executionStart,
        executionEnd: Date.now()
    };
}

async function callFunc(parsedFunc: ParsedFunc, executionStart: number) {
    const { func, args, CallId } = parsedFunc;
    const returned = await func.apply(undefined, args);
    const rv: FunctionReturn = {
        type: "returned",
        value: returned,
        CallId,
        executionStart,
        executionEnd: Date.now()
    };
    return rv;
}

export async function trampoline(request: Request, response: Response) {
    let CallId: string | undefined;
    const executionStart = Date.now();
    try {
        const parsedFunc = parseFunc(request.body);
        CallId = parsedFunc.CallId;
        const returned = await callFunc(parsedFunc, executionStart);
        response.send(returned);
    } catch (err) {
        response.send(createErrorResponse(err, CallId, executionStart));
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

let pubsub: PubSubApi.Pubsub;

async function initialize() {
    if (!pubsub) {
        const auth = await google.auth.getClient({
            scopes: ["https://www.googleapis.com/auth/cloud-platform"]
        });
        google.options({ auth });
        pubsub = google.pubsub("v1");
    }
}

export async function pubsubTrampoline(event: CloudFunctionPubSubEvent): Promise<void> {
    const start = Date.now();
    await initialize();
    let CallId: string = "";
    let ResponseQueueId: string | undefined;
    try {
        const str = Buffer.from(event.data.data!, "base64");
        const parsedFunc = parseFunc(JSON.parse(str.toString()));
        ({ CallId, ResponseQueueId } = parsedFunc);
        const returned = await callFunc(parsedFunc, start);
        await publish(pubsub, ResponseQueueId!, JSON.stringify(returned), { CallId });
    } catch (err) {
        console.error(err);
        if (ResponseQueueId) {
            const response = createErrorResponse(err, CallId, start);
            await publish(pubsub, ResponseQueueId!, JSON.stringify(response), { CallId });
        }
    }
}
