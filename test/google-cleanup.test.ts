import test, { ExecutionContext } from "ava";
import { faastGoogle, GoogleFaastModule, log } from "../index";
import { checkResourcesCleanedUp, keysOf, quietly } from "./fixtures/util";

export async function getGoogleResources(mod: GoogleFaastModule) {
    const { cloudFunctions, pubsub } = mod.state.services;
    const {
        trampoline,
        requestQueueTopic,
        responseQueueTopic,
        responseSubscription,
        region,
        ...rest
    } = mod.state.resources;
    const _exhaustiveCheck: Required<typeof rest> = {};

    const functionResult = await quietly(
        cloudFunctions.projects.locations.functions.get({
            name: trampoline
        })
    );

    const requestQueueResult = await quietly(
        pubsub.projects.topics.get({
            topic: requestQueueTopic
        })
    );

    const responseQueueResult = await quietly(
        pubsub.projects.topics.get({
            topic: responseQueueTopic
        })
    );

    const subscriptionResult = await quietly(
        pubsub.projects.subscriptions.get({ subscription: responseSubscription })
    );

    return {
        functionResult,
        requestQueueResult,
        responseQueueResult,
        subscriptionResult
    };
}

export function checkResourcesExist<T extends object>(t: ExecutionContext, resources: T) {
    t.true(keysOf(resources).length === 4);
    for (const key of keysOf(resources)) {
        t.truthy(resources[key]);
    }
}

test("remote google cleanup removes ephemeral resources", async t => {
    try {
        const func = await faastGoogle({}, "./fixtures/functions", {
            mode: "queue"
        });
        checkResourcesExist(t, await getGoogleResources(func));
        await func.cleanup();
        checkResourcesCleanedUp(t, await getGoogleResources(func));
    } catch (err) {
        log.warn(`google cleanup error: ${err.stack}`);
        throw err;
    }
});
