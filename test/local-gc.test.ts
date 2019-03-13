import test from "ava";
import * as faast from "../index";
import * as functions from "./fixtures/functions";
import { record } from "./fixtures/util";

test("local garbage collector works for functions that are called", async t => {
    // Idea behind this test: create a faast module and make a call. Then
    // cleanup while leaving the resources in place. Then create another faast
    // module and set its retention to 0, and use a recorder to observe what its
    // garbage collector cleans up. Verify the first faast module's resources
    // are cleaned up, which shows that the garbage collector did its job.
    const mod = await faast.faastLocal(functions, "./fixtures/functions");
    await mod.functions.hello("gc-test");
    await mod.cleanup({ deleteResources: false });
    const gcRecorder = record(async (_dir: string) => {});
    const mod2 = await faast.faastLocal(functions, "./fixtures/functions", {
        gc: true,
        gcWorker: gcRecorder,
        retentionInDays: 0
    });
    await mod2.cleanup();
    t.truthy(gcRecorder.recordings.find(({ args: [dir] }) => dir === mod.state.tempDir));
    await mod.cleanup();
});

test("local garbage collector works for functions that are never called", async t => {
    const mod = await faast.faastLocal(functions, "./fixtures/functions");
    await mod.cleanup({ deleteResources: false });
    const gcRecorder = record(async (_dir: string) => {});

    const mod2 = await faast.faastLocal(functions, "./fixtures/functions", {
        gc: true,
        gcWorker: gcRecorder,
        retentionInDays: 0
    });

    await mod2.cleanup();
    t.truthy(gcRecorder.recordings.find(({ args: [dir] }) => dir === mod.state.tempDir));
    await mod.cleanup();
});
