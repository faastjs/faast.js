import * as cloudify from "../src/cloudify";

function quietly<T>(p: Promise<T>) {
    return p.catch(_ => {});
}

async function getResources(func: cloudify.GoogleCloudFunction) {
    const {
        services: { cloudFunctions, pubsub },
        resources: {
            trampoline,
            isEmulator,
            requestQueueTopic,
            responseQueueTopic,
            responseSubscription,
            ...rest
        }
    } = func.getState();
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

function checkResourcesCleanedUp(resources: object) {
    for (const key of Object.keys(resources)) {
        expect(resources[key]).toBeUndefined();
    }
}

function checkResourcesExist(resources: object) {
    expect(Object.keys(resources).length).toBe(4);
    for (const key of Object.keys(resources)) {
        expect(resources[key]).toBeTruthy();
    }
}

test.only(
    "removes ephemeral resources",
    async () => {
        const cloud = cloudify.create("google");
        const func = await cloud.createFunction("./functions", { useQueue: true });
        checkResourcesExist(await getResources(func));
        await func.cleanup();
        checkResourcesCleanedUp(await getResources(func));
    },
    90 * 1000
);

test(
    "removes ephemeral resources from a resource list",
    async () => {
        const cloud = cloudify.create("google");
        const func = await cloud.createFunction("./functions", { useQueue: true });
        checkResourcesExist(await getResources(func));
        const resourceList = func.getResourceList();
        await cloud.cleanupResources(resourceList);
        checkResourcesCleanedUp(await getResources(func));
    },
    90 * 1000
);
