import test from "ava";
import { faastGoogle } from "../index";
import { GoogleResources, GoogleServices } from "../src/google/google-faast";
import * as functions from "./fixtures/functions";
import { contains, record } from "./fixtures/util";

test("remote google garbage collector works for functions that are called", async t => {
    // Idea behind this test: create a faast module and make a call. Then
    // cleanup while leaving the resources in place. Then create another
    // function and set its retention to 0, and use a recorder to observe what
    // its garbage collector cleans up. Verify the first function's resources
    // would be cleaned up, which shows that the garbage collector did its job.
    const func = await faastGoogle(functions, "./fixtures/functions", {
        mode: "queue"
    });
    await func.functions.hello("gc-test");
    await func.cleanup({ deleteResources: false });
    const gcRecorder = record(
        async (_resources: GoogleResources, _: GoogleServices) => {}
    );
    const func2 = await faastGoogle(functions, "./fixtures/functions", {
        gc: true,
        gcWorker: gcRecorder,
        retentionInDays: 0
    });

    await func2.cleanup();
    const resources = func.state.resources;
    t.truthy(gcRecorder.recordings.find(({ args: [work] }) => contains(work, resources)));
    await func.cleanup();
});

test("remote google garbage collector works for functions that are never called", async t => {
    const func = await faastGoogle(functions, "./fixtures/functions", {
        mode: "queue",
        gc: false
    });
    await func.cleanup({ deleteResources: false });
    const gcRecorder = record(
        async (_resources: GoogleResources, _: GoogleServices) => {}
    );
    const func2 = await faastGoogle(functions, "./fixtures/functions", {
        gc: true,
        gcWorker: gcRecorder,
        retentionInDays: 0
    });

    await func2.cleanup();
    const resources = func.state.resources;
    t.truthy(gcRecorder.recordings.find(({ args: [work] }) => contains(work, resources)));
    await func.cleanup();
});
