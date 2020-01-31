import { GoogleFaastModule } from "../../index";
import { getRequestSubscription } from "../../src/google/google-faast";

export function quietly<T>(p: Promise<T>) {
    return p.catch(_ => {});
}

export async function getGoogleResources(mod: GoogleFaastModule) {
    const { cloudFunctions, pubsub } = mod.state.services;
    const {
        trampoline,
        requestQueueTopic,
        requestSubscription,
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

    const responseSubscriptionResult = await quietly(
        pubsub.projects.subscriptions.get({ subscription: responseSubscription })
    );

    const requestSubscriptionResult = await quietly(
        pubsub.projects.subscriptions.get({ subscription: requestSubscription })
    );

    return {
        functionResult,
        requestQueueResult,
        responseQueueResult,
        responseSubscriptionResult,
        requestSubscriptionResult
    };
}
