import test, { ExecutionContext } from "ava";
import * as faast from "../src/faast";
import { keys } from "../src/shared";
import { quietly, checkResourcesCleanedUp } from "./util";

export async function getGoogleResources(func: faast.GoogleCloudFunction) {
    const { cloudFunctions, pubsub } = func.state.services;
    const {
        trampoline,
        requestQueueTopic,
        responseQueueTopic,
        responseSubscription,
        region,
        ...rest
    } = func.state.resources;
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
    t.true(keys(resources).length === 4);
    for (const key of keys(resources)) {
        t.truthy(resources[key]);
    }
}

test("google cleanup removes ephemeral resources", async t => {
    const func = await faast.faastify("google", {}, "./functions", {
        mode: "queue"
    });
    checkResourcesExist(t, await getGoogleResources(func));
    await func.cleanup();
    checkResourcesCleanedUp(t, await getGoogleResources(func));
});
