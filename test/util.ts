import * as cloudify from "../src/cloudify";

export const sum = (a: number[]) => a.reduce((total, n) => total + n, 0);

export const avg = (a: number[]) => sum(a) / a.length;

export const stdev = (a: number[]) => {
    const average = avg(a);
    return Math.sqrt(avg(a.map(v => (v - average) ** 2)));
};

export function quietly<T>(p: Promise<T>) {
    return p.catch(_ => {});
}

export async function getGoogleResources(func: cloudify.GoogleCloudFunction) {
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
    } = func.state;
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

export function checkResourcesCleanedUp(resources: object) {
    for (const key of Object.keys(resources)) {
        expect(resources[key]).toBeUndefined();
    }
}

export function checkResourcesExist(resources: object) {
    expect(Object.keys(resources).length).toBe(4);
    for (const key of Object.keys(resources)) {
        expect(resources[key]).toBeTruthy();
    }
}
