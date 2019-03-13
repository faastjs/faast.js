import test from "ava";
import { faastGoogle } from "../index";
import { GoogleResources, GoogleServices } from "../src/google/google-faast";
import * as functions from "./fixtures/functions";
import { contains, record } from "./fixtures/util";

test("remote google garbage collector works for functions that are called", async t => {
    // Idea behind this test: create a faast module and make a call. Then
    // cleanup while leaving the resources in place. Then create another faast
    // module and set its retention to 0, and use a recorder to observe what its
    // garbage collector cleans up. Verify the first faast module's resources
    // would be cleaned up, which shows that the garbage collector did its job.
    const mod = await faastGoogle(functions, "./fixtures/functions", {
        mode: "queue"
    });
    await mod.functions.hello("gc-test");
    await mod.cleanup({ deleteResources: false });
    const gcRecorder = record(
        async (_resources: GoogleResources, _: GoogleServices) => {}
    );
    const mod2 = await faastGoogle(functions, "./fixtures/functions", {
        gc: true,
        _gcWorker: gcRecorder,
        retentionInDays: 0
    });

    await mod2.cleanup();
    const resources = mod.state.resources;
    t.truthy(gcRecorder.recordings.find(({ args: [work] }) => contains(work, resources)));
    await mod.cleanup();
});

test("remote google garbage collector works for functions that are never called", async t => {
    const mod = await faastGoogle(functions, "./fixtures/functions", {
        mode: "queue",
        gc: false
    });
    await mod.cleanup({ deleteResources: false });
    const gcRecorder = record(
        async (_resources: GoogleResources, _: GoogleServices) => {}
    );
    const mod2 = await faastGoogle(functions, "./fixtures/functions", {
        gc: true,
        _gcWorker: gcRecorder,
        retentionInDays: 0
    });

    await mod2.cleanup();
    const resources = mod.state.resources;
    t.truthy(gcRecorder.recordings.find(({ args: [work] }) => contains(work, resources)));
    await mod.cleanup();
});
