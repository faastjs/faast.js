import test from "ava";
import * as faast from "../index";
import * as functions from "./fixtures/functions";
import { defaultGcWorker } from "../src/local/local-faast";
import { existsSync } from "fs-extra";

test("local garbage collector works for functions that are called", async t => {
    // Idea behind this test: create a faast module and make a call. Then
    // cleanup while leaving the resources in place. Then create another faast
    // module and set its retention to 0, and intercept the garbage collector
    // worker to restrict what is cleaned up to the first function only (to
    // avoid interference with other tests). Verify the first faast module's
    // resources are cleaned up, which shows that the garbage collector did its
    // job.
    const mod = await faast.faastLocal(functions, "./fixtures/functions");
    try {
        await mod.functions.hello("gc-test");
        await mod.cleanup({ deleteResources: false });
        const mod2 = await faast.faastLocal(functions, "./fixtures/functions", {
            gc: "force",
            _gcWorker: async dir => {
                if (dir === mod.state.tempDir) {
                    await defaultGcWorker(dir);
                }
            },
            retentionInDays: 0
        });
        await mod2.cleanup();
        t.false(existsSync(mod.state.tempDir));
    } finally {
        await mod.cleanup();
    }
});

test("local garbage collector works for functions that are never called", async t => {
    const mod = await faast.faastLocal(functions, "./fixtures/functions");
    try {
        await mod.cleanup({ deleteResources: false });
        const mod2 = await faast.faastLocal(functions, "./fixtures/functions", {
            gc: "force",
            _gcWorker: async dir => {
                if (dir === mod.state.tempDir) {
                    await defaultGcWorker(dir);
                }
            },
            retentionInDays: 0
        });

        await mod2.cleanup();
        t.false(existsSync(mod.state.tempDir));
    } finally {
        await mod.cleanup();
    }
});
