import test from "ava";
import { Request, Response } from "express";
import { google } from "googleapis";
import * as uuidv4 from "uuid/v4";
import {
    getResponseQueueTopic,
    getResponseSubscription,
    GoogleMetrics
} from "../src/google/google-faast";
import { receiveMessages } from "../src/google/google-queue";
import { makeTrampoline as makeTrampolineHttps } from "../src/google/google-trampoline-https";
import {
    CloudFunctionContext,
    makeTrampoline as makeTrampolineQueue
} from "../src/google/google-trampoline-queue";
import { Message } from "../src/provider";
import { deserialize, serialize, serializeFunctionArgs } from "../src/serialize";
import { Wrapper } from "../src/wrapper";
import * as funcs from "./fixtures/functions";
import { title } from "./fixtures/util";

test(title("google", "trampoline https mode"), async t => {
    t.plan(1);
    process.env.FAAST_SILENT = "true";
    const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
    const { trampoline } = makeTrampolineHttps(wrapper);
    const arg = "abc123";
    const name = funcs.identityNum.name;
    const call = {
        callId: "42",
        name,
        args: serializeFunctionArgs(name, [arg], true),
        modulePath: "./fixtures/functions"
    };

    const headers: Request["headers"] = {
        "function-execution-id": "google-trampoline-test-function-execution-id"
    };

    const request = { body: call, headers } as Request;
    const response = {
        send: (obj: Message[]) => {
            if (obj[0].kind === "response") {
                const [ret] = deserialize(obj[0].body.value);
                t.is(ret, arg);
            }
        }
    } as Response;
    await trampoline(request, response);
});

test(title("google", "trampoline queue mode"), async t => {
    t.plan(2);
    process.env.FAAST_SILENT = "true";
    const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
    const FunctionName = `faast-${uuidv4()}`;

    const auth = await google.auth.getClient({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });

    google.options({ auth });
    const pubsub = google.pubsub("v1");
    const project = await google.auth.getProjectId();

    process.env.GCP_PROJECT = project;
    process.env.FUNCTION_NAME = FunctionName;

    const topic = await pubsub.projects.topics.create({
        name: getResponseQueueTopic(project, FunctionName)
    });
    const topicName = topic.data.name ?? undefined;

    const subscriptionName = getResponseSubscription(project, FunctionName);
    const subscription = await pubsub.projects.subscriptions.create({
        name: subscriptionName,
        requestBody: {
            topic: topicName
        }
    });

    const arg = "987zyx";

    try {
        const { trampoline } = makeTrampolineQueue(wrapper);
        const name = funcs.identityNum.name;
        const call = {
            callId: "42",
            name,
            args: serializeFunctionArgs(name, [arg], true),
            modulePath: "./fixtures/functions",
            ResponseQueueId: topicName
        };
        const event = {
            data: Buffer.from(serialize(call)).toString("base64")
        };

        const context: CloudFunctionContext = {
            eventId: "",
            timestamp: "",
            eventType: "",
            resource: {}
        };

        await trampoline(event, context);

        const metrics = new GoogleMetrics();
        const cancel = new Promise<void>(_ => {});

        const result = await receiveMessages(pubsub, subscriptionName, metrics, cancel);
        const msg = result.Messages[0];
        t.is(msg.kind, "response");
        if (msg.kind === "response") {
            const [ret] = deserialize(msg.body.value);
            t.is(ret, arg);
        }
    } finally {
        await pubsub.projects.subscriptions.delete({
            subscription: subscriptionName
        });
        await pubsub.projects.topics.delete({
            topic: topicName
        });
    }
});
