import { faastify } from "../src/faast";
import * as functions from "../test/functions";
import { GoogleResources, GoogleServices } from "../src/google/google-faast";
import test from "ava";
import { record, contains } from "../test/util";

test("google garbage collector works for functions that are called", async t => {
    // Idea behind this test: create a faast function and make a call.
    // Then cleanup while leaving the resources in place. Then create another
    // function and set its retention to 0, and use a recorder to observe what
    // its garbage collector cleans up. Verify the first function's resources
    // would be cleaned up, which shows that the garbage collector did its job.
    const func = await faastify("google", functions, "../test/functions", {
        gc: false,
        mode: "queue"
    });
    await func.functions.hello("gc-test");
    await func.cleanup({ deleteResources: false });
    const gcRecorder = record(
        async (_: GoogleServices, _resources: GoogleResources) => {}
    );
    const func2 = await faastify("google", functions, "../test/functions", {
        gc: true,
        gcWorker: gcRecorder,
        retentionInDays: 0
    });

    await func2.cleanup();
    const resources = func.state.resources;
    t.truthy(gcRecorder.recordings.find(r => contains(r.args[1], resources)));
    await func.cleanup();
});

test("google garbage collector works for functions that are never called", async t => {
    const func = await faastify("google", functions, "../test/functions", {
        gc: false,
        mode: "queue"
    });
    await func.cleanup({ deleteResources: false });
    const gcRecorder = record(
        async (_: GoogleServices, _resources: GoogleResources) => {}
    );
    const func2 = await faastify("google", functions, "../test/functions", {
        gc: true,
        gcWorker: gcRecorder,
        retentionInDays: 0
    });

    await func2.cleanup();
    const resources = func.state.resources;
    t.truthy(gcRecorder.recordings.find(r => contains(r.args[1], resources)));
    await func.cleanup();
});
