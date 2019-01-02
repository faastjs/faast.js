import { tmpdir } from "os";
import { join } from "path";
import * as faast from "../src/faast";
import { readdir } from "../src/fs";
import * as functions from "../test/functions";
import { checkResourcesCleanedUp, getLocalResources } from "../test/tests";

async function checkLocalTempDirectoryCleanedUp() {
    const dir = join(tmpdir(), "faast");
    const entries = await readdir(dir);
    expect(entries.length).toBe(0);
}

test("garbage collector works for functions that are called", async () => {
    // Idea behind this test: create a cloudified function and make a call.
    // Then call stop() to leave the resources in place. Then create another
    // function and set its retention to 0, and have its garbage collector
    // clean up the first function. Verify the first function's resources
    // are cleaned up, which shows that the garbage collector did its job.
    const func = await faast.faastify("local", functions, "../test/functions");
    await func.functions.hello("gc-test");
    await func.stop();
    const func2 = await faast.faastify("local", functions, "../test/functions", {
        gc: "on",
        retentionInDays: 0
    });
    await func2.cleanup();
    await checkResourcesCleanedUp(await getLocalResources(func));
    await checkLocalTempDirectoryCleanedUp();
});

test("garbage collector works for functions that are never called", async () => {
    const func = await faast.faastify("local", functions, "../test/functions");
    await func.stop();
    const func2 = await faast.faastify("local", functions, "../test/functions", {
        gc: "on",
        retentionInDays: 0
    });

    await func2.cleanup();
    await checkResourcesCleanedUp(await getLocalResources(func));
    await checkLocalTempDirectoryCleanedUp();
});
