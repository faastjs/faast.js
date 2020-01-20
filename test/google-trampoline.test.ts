import test from "ava";
import { Request, Response } from "express";
import * as uuidv4 from "uuid/v4";
import {
    getResponseQueueTopic,
    getResponseSubscription,
    GoogleMetrics,
    initializeGoogleServices
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

test(title("google", "trampoline https mode with promise response"), async t => {
    t.plan(1);
    process.env.FAAST_SILENT = "true";
    const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
    const { trampoline } = makeTrampolineHttps(wrapper);
    const arg = "promise with https on google";
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
            if (obj[0].kind === "promise") {
                const [ret] = deserialize(obj[0].value);
                t.is(ret, arg);
            }
        }
    } as Response;
    await trampoline(request, response);
});

test(title("google", "trampoline https mode with async iterator response"), async t => {
    t.plan(3);
    process.env.FAAST_SILENT = "true";
    const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
    const { trampoline } = makeTrampolineHttps(wrapper);
    const arg = "async iterator with https on google";
    const name = funcs.asyncGenerator.name;
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
            const messages: any = [];
            obj.forEach(msg => {
                if (msg.kind === "iterator") {
                    const value = deserialize(msg.value)[0];
                    messages[msg.sequence] = value;
                }
            });
            t.is(messages.length, 2);
            t.deepEqual(messages[0], { done: false, value: arg });
            t.deepEqual(messages[1], { done: true });
        }
    } as Response;
    await trampoline(request, response);
});

test(title("google", "trampoline queue mode with promise response"), async t => {
    t.plan(2);
    process.env.FAAST_SILENT = "true";
    const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
    const FunctionName = `faast-${uuidv4()}`;

    const services = await initializeGoogleServices();
    const { pubsub, google } = services;
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

    const arg = "promise with queue on google";

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
        t.is(msg.kind, "promise");
        if (msg.kind === "promise") {
            const [ret] = deserialize(msg.value);
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

test(title("google", "trampoline queue mode with async iterator response"), async t => {
    t.plan(3);
    process.env.FAAST_SILENT = "true";
    const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
    const FunctionName = `faast-${uuidv4()}`;

    const services = await initializeGoogleServices();
    const { pubsub, google } = services;
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

    const arg = "async iterator with queue on google";

    try {
        const { trampoline } = makeTrampolineQueue(wrapper);
        const name = funcs.asyncGenerator.name;
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

        const messages: any = [];
        let received = 0;
        while (received < 2) {
            const result = await receiveMessages(
                pubsub,
                subscriptionName,
                metrics,
                cancel
            );
            result.Messages.forEach(msg => {
                if (msg.kind === "iterator") {
                    const value = deserialize(msg.value)[0];
                    messages[msg.sequence] = value;
                    received++;
                }
            });
        }
        t.is(messages.length, 2);
        t.deepEqual(messages[0], { done: false, value: arg });
        t.deepEqual(messages[1], { done: true });
    } finally {
        await pubsub.projects.subscriptions.delete({
            subscription: subscriptionName
        });
        await pubsub.projects.topics.delete({
            topic: topicName
        });
    }
});
