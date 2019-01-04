import * as faast from "../src/faast";
import * as functions from "../test/functions";
import { checkResourcesCleanedUp, getLocalResources, record } from "../test/tests";

test("garbage collector works for functions that are called", async () => {
    // Idea behind this test: create a cloudified function and make a call.
    // Then call stop() to leave the resources in place. Then create another
    // function and set its retention to 0, and use a recorder to observe what
    // its garbage collector cleans up. Verify the first function's resources
    // are cleaned up, which shows that the garbage collector did its job.
    const func = await faast.faastify("local", functions, "../test/functions");
    await func.functions.hello("gc-test");
    await func.stop();
    const gcRecorder = record(async (_dir: string) => {});
    const func2 = await faast.faastify("local", functions, "../test/functions", {
        gc: true,
        gcWorker: gcRecorder,
        retentionInDays: 0
    });
    await func2.cleanup();
    expect(gcRecorder.recordings.find(r => r.args[0] === func.state.tempDir));
    await func.cleanup();
});

test("garbage collector works for functions that are never called", async () => {
    const func = await faast.faastify("local", functions, "../test/functions");
    await func.stop();
    const gcRecorder = record(async (_dir: string) => {});

    const func2 = await faast.faastify("local", functions, "../test/functions", {
        gc: true,
        gcWorker: gcRecorder,
        retentionInDays: 0
    });

    await func2.cleanup();
    expect(gcRecorder.recordings.find(r => r.args[0] === func.state.tempDir));
    await func.cleanup();
});
