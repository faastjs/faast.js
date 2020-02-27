/**
 * The purpose of this test is to check that the trampoline function on google
 * can route calls, invoke the wrapper, and return values correctly, without
 * actually creating a cloud function. However, it does use real cloud queues.
 */

import test from "ava";
import { Request, Response } from "express";
import { GoogleApis } from "googleapis";
import { v4 as uuidv4 } from "uuid";
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
import { filterMessages, Kind } from "../src/provider";
import { serialize, serializeFunctionArgs } from "../src/serialize";
import { Wrapper } from "../src/wrapper";
import * as funcs from "./fixtures/functions";
import { checkIteratorMessages, expectMessage, title } from "./fixtures/util";
import { sleep } from "../src/shared";

process.env.FAAST_SILENT = "true";

interface GoogleTrampolineTestResources {
    topicName: string;
    subscriptionName: string;
    google: GoogleApis;
}

async function initGoogleResources() {
    const services = await initializeGoogleServices();
    const { google } = services;
    const pubsub = google.pubsub("v1");
    const project = await google.auth.getProjectId();
    const FunctionName = `faast-${uuidv4()}`;
    const topic = await pubsub.projects.topics.create({
        name: getResponseQueueTopic(project, FunctionName)
    });
    const topicName = topic.data.name!;

    const subscriptionName = getResponseSubscription(project, FunctionName);
    await pubsub.projects.subscriptions.create({
        name: subscriptionName,
        requestBody: {
            topic: topicName
        }
    });

    const resources: GoogleTrampolineTestResources = {
        topicName,
        subscriptionName,
        google
    };
    return resources;
}

async function cleanupGoogleResources(resources: GoogleTrampolineTestResources) {
    const { google, subscriptionName, topicName } = resources;
    const pubsub = google.pubsub("v1");
    // Give google a little time to propagate the existence of the queue.
    await sleep(5000);
    await pubsub.projects.subscriptions.delete({
        subscription: subscriptionName
    });
    await pubsub.projects.topics.delete({
        topic: topicName
    });
}

async function getMessages<K extends Kind>(
    resources: GoogleTrampolineTestResources,
    kind: K,
    nExpected: number
) {
    const { google, subscriptionName } = resources;
    const pubsub = google.pubsub("v1");
    const metrics = new GoogleMetrics();
    const cancel = new Promise<void>(_ => {});
    const result = [];
    while (result.length < nExpected) {
        const messages = await receiveMessages(pubsub, subscriptionName, metrics, cancel);
        result.push(...filterMessages(messages.Messages, kind));
    }
    return result;
}

test(title("google", "trampoline https mode with promise response"), async t => {
    const resources = await initGoogleResources();
    try {
        const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
        const { trampoline } = makeTrampolineHttps(wrapper);
        const arg = "promise with https on google";
        const name = funcs.identityNum.name;
        const call = {
            callId: "42",
            name,
            args: serializeFunctionArgs(name, [arg], true),
            modulePath: "./fixtures/functions",
            ResponseQueueId: resources.topicName
        };

        const headers: Request["headers"] = {
            "function-execution-id": "google-trampoline-test-function-execution-id"
        };

        const request = { body: call, headers } as Request;
        const response = { send: (_: any) => {} } as Response;

        await trampoline(request, response);

        const [msg] = await getMessages(resources, "promise", 1);
        expectMessage(t, msg, "promise", arg);
    } finally {
        await cleanupGoogleResources(resources);
    }
});

test(title("google", "trampoline https mode with async iterator response"), async t => {
    const resources = await initGoogleResources();
    try {
        const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
        const { trampoline } = makeTrampolineHttps(wrapper);
        const arg = ["async iterator with https on google", "second arg"];
        const name = funcs.asyncGenerator.name;
        const call = {
            callId: "42",
            name,
            args: serializeFunctionArgs(name, [arg], true),
            modulePath: "./fixtures/functions",
            ResponseQueueId: resources.topicName
        };

        const headers: Request["headers"] = {
            "function-execution-id": "google-trampoline-test-function-execution-id"
        };

        const request = { body: call, headers } as Request;
        const response = { send: (_: any) => {} } as Response;

        await trampoline(request, response);

        const messages = await getMessages(resources, "iterator", arg.length + 1);
        checkIteratorMessages(t, messages, arg);
    } finally {
        await cleanupGoogleResources(resources);
    }
});

test(title("google", "trampoline queue mode with promise response"), async t => {
    const resources = await initGoogleResources();
    try {
        const arg = "promise with queue on google";
        const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
        const { trampoline } = makeTrampolineQueue(wrapper);
        const name = funcs.identityNum.name;
        const call = {
            callId: "42",
            name,
            args: serializeFunctionArgs(name, [arg], true),
            modulePath: "./fixtures/functions",
            ResponseQueueId: resources.topicName
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

        const [msg] = await getMessages(resources, "promise", 1);
        expectMessage(t, msg, "promise", arg);
    } finally {
        await cleanupGoogleResources(resources);
    }
});

test(title("google", "trampoline queue mode with async iterator response"), async t => {
    const resources = await initGoogleResources();
    try {
        const wrapper = new Wrapper(funcs, { childProcess: false, wrapperLog: () => {} });
        const arg = ["async iterator with queue on google"];

        const { trampoline } = makeTrampolineQueue(wrapper);
        const name = funcs.asyncGenerator.name;
        const call = {
            callId: "42",
            name,
            args: serializeFunctionArgs(name, [arg], true),
            modulePath: "./fixtures/functions",
            ResponseQueueId: resources.topicName
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

        const messages = await getMessages(resources, "iterator", arg.length + 1);
        checkIteratorMessages(t, messages, arg);
    } finally {
        await cleanupGoogleResources(resources);
    }
});
