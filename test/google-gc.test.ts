import test from "ava";
import { faastGoogle } from "../index";
import { defaultGcWorker } from "../src/google/google-faast";
import * as functions from "./fixtures/functions";
import { checkResourcesCleanedUp, contains } from "./fixtures/util";
import { getGoogleResources } from "./fixtures/util-google";

test("remote google garbage collector works for functions that are called", async t => {
    // Idea behind this test: create a faast module and make a call. Then
    // cleanup while leaving the resources in place. Then create another faast
    // module and set its retention to 0, and use a synthetic gc worker to
    // restrict what the garbage collector cleans up to the first function (to
    // avoid interference with other test resources). Verify the first faast
    // module's resources would be cleaned up, which shows that the garbage
    // collector did its job.
    const mod = await faastGoogle(functions, {
        mode: "queue"
    });
    await mod.functions.hello("gc-test");
    await mod.cleanup({ deleteResources: false });
    const mod2 = await faastGoogle(functions, {
        gc: "force",
        retentionInDays: 0,
        _gcWorker: async (work, services) => {
            if (contains(work, mod.state.resources)) {
                await defaultGcWorker(work, services);
            }
        }
    });

    await mod2.cleanup();
    await checkResourcesCleanedUp(t, await getGoogleResources(mod));
    await mod.cleanup();
});

test("remote google garbage collector works for functions that are never called", async t => {
    const mod = await faastGoogle(functions, {
        mode: "queue",
        gc: "off"
    });
    await mod.cleanup({ deleteResources: false });
    const mod2 = await faastGoogle(functions, {
        gc: "force",
        retentionInDays: 0,
        _gcWorker: async (work, services) => {
            if (contains(work, mod.state.resources)) {
                await defaultGcWorker(work, services);
            }
        }
    });

    await mod2.cleanup();
    await checkResourcesCleanedUp(t, await getGoogleResources(mod));
    await mod.cleanup();
});
