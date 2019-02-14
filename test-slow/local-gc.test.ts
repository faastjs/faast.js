import * as faast from "../src/faast";
import * as functions from "../test/functions";
import test from "ava";
import { record } from "../test/util";

test("local garbage collector works for functions that are called", async t => {
    // Idea behind this test: create a cloudified function and make a call.
    // Then cleanup while leaving the resources in place. Then create another
    // function and set its retention to 0, and use a recorder to observe what
    // its garbage collector cleans up. Verify the first function's resources
    // are cleaned up, which shows that the garbage collector did its job.
    const func = await faast.faastify("local", functions, "../test/functions", {
        gc: false
    });
    await func.functions.hello("gc-test");
    await func.cleanup({ deleteResources: false });
    const gcRecorder = record(async (_dir: string) => {});
    const func2 = await faast.faastify("local", functions, "../test/functions", {
        gc: true,
        gcWorker: gcRecorder,
        retentionInDays: 0
    });
    await func2.cleanup();
    t.truthy(gcRecorder.recordings.find(r => r.args[0] === func.state.tempDir));
    await func.cleanup();
});

test("local garbage collector works for functions that are never called", async t => {
    const func = await faast.faastify("local", functions, "../test/functions", {
        gc: false
    });
    await func.cleanup({ deleteResources: false });
    const gcRecorder = record(async (_dir: string) => {});

    const func2 = await faast.faastify("local", functions, "../test/functions", {
        gc: true,
        gcWorker: gcRecorder,
        retentionInDays: 0
    });

    await func2.cleanup();
    t.truthy(gcRecorder.recordings.find(r => r.args[0] === func.state.tempDir));
    await func.cleanup();
});
