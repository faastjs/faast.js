import * as cloudify from "../src/cloudify";
import { checkResourcesCleanedUp, getGoogleResources } from "../test/util";
import * as functions from "./functions";

test(
    "garbage collector works for functions that are called",
    async () => {
        // Idea behind this test: create a cloudified function and make a call.
        // Then call stop() to leave the resources in place. Then create another
        // function and set its retention to 0, and have its garbage collector
        // clean up the first function. Verify the first function's resources
        // are cleaned up, which shows that the garbage collector did its job.
        const cloud = cloudify.create("google");
        const func = await cloud.createFunction("./functions");
        const remote = func.cloudifyModule(functions);
        await remote.hello("gc-test");
        await func.stop();
        const func2 = await cloud.createFunction("./functions", {
            gc: true,
            retentionInDays: 0
        });

        await func2.cleanup();
        await checkResourcesCleanedUp(await getGoogleResources(func));
    },
    180 * 1000
);

test(
    "garbage collector works for functions that are never called",
    async () => {
        const cloud = cloudify.create("google");
        const func = await cloud.createFunction("./functions");
        await func.stop();
        const func2 = await cloud.createFunction("./functions", {
            gc: true,
            retentionInDays: 0
        });

        await func2.cleanup();
        await checkResourcesCleanedUp(await getGoogleResources(func));
    },
    180 * 1000
);
