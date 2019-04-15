import { GoogleFaastModule } from "../../index";
import { quietly } from "./util";

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
