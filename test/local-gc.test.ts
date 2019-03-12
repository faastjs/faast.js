import test from "ava";
import * as faast from "../index";
import * as functions from "./fixtures/functions";
import { record } from "./fixtures/util";

test("local garbage collector works for functions that are called", async t => {
    // Idea behind this test: create a cloudified function and make a call.
    // Then cleanup while leaving the resources in place. Then create another
    // function and set its retention to 0, and use a recorder to observe what
    // its garbage collector cleans up. Verify the first function's resources
    // are cleaned up, which shows that the garbage collector did its job.
    const func = await faast.faastLocal(functions, "./fixtures/functions");
    await func.functions.hello("gc-test");
    await func.cleanup({ deleteResources: false });
    const gcRecorder = record(async (_dir: string) => {});
    const func2 = await faast.faastLocal(functions, "./fixtures/functions", {
        gc: true,
        gcWorker: gcRecorder,
        retentionInDays: 0
    });
    await func2.cleanup();
    t.truthy(gcRecorder.recordings.find(({ args: [dir] }) => dir === func.state.tempDir));
    await func.cleanup();
});

test("local garbage collector works for functions that are never called", async t => {
    const func = await faast.faastLocal(functions, "./fixtures/functions");
    await func.cleanup({ deleteResources: false });
    const gcRecorder = record(async (_dir: string) => {});

    const func2 = await faast.faastLocal(functions, "./fixtures/functions", {
        gc: true,
        gcWorker: gcRecorder,
        retentionInDays: 0
    });

    await func2.cleanup();
    t.truthy(gcRecorder.recordings.find(({ args: [dir] }) => dir === func.state.tempDir));
    await func.cleanup();
});
