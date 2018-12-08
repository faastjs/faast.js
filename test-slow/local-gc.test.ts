import { tmpdir } from "os";
import { join } from "path";
import * as cloudify from "../src/cloudify";
import { readdir } from "../src/fs";
import * as functions from "../test/functions";
import { checkResourcesCleanedUp, getLocalResources } from "../test/tests";

async function checkLocalTempDirectoryCleanedUp() {
    const cloudifyDir = join(tmpdir(), "cloudify");
    const entries = await readdir(cloudifyDir);
    expect(entries.length).toBe(0);
}

test("garbage collector works for functions that are called", async () => {
    // Idea behind this test: create a cloudified function and make a call.
    // Then call stop() to leave the resources in place. Then create another
    // function and set its retention to 0, and have its garbage collector
    // clean up the first function. Verify the first function's resources
    // are cleaned up, which shows that the garbage collector did its job.
    const cloud = cloudify.create("local");
    const func = await cloud.createFunction("../test/functions");
    const remote = func.cloudifyModule(functions);

    await remote.hello("gc-test");
    await func.stop();
    const func2 = await cloud.createFunction("../test/functions", {
        gc: true,
        retentionInDays: 0
    });
    await func2.cleanup();
    await checkResourcesCleanedUp(await getLocalResources(func));
    await checkLocalTempDirectoryCleanedUp();
});

test("garbage collector works for functions that are never called", async () => {
    const cloud = cloudify.create("local");
    const func = await cloud.createFunction("../test/functions");
    await func.stop();
    const func2 = await cloud.createFunction("../test/functions", {
        gc: true,
        retentionInDays: 0
    });

    await func2.cleanup();
    await checkResourcesCleanedUp(await getLocalResources(func));
    await checkLocalTempDirectoryCleanedUp();
});
