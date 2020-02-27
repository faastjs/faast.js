import test from "ava";
import { CloudWatchLogs } from "aws-sdk";
import { v4 as uuid } from "uuid";
import { faastAws, log, throttle } from "../index";
import { defaultGcWorker, clearLastGc } from "../src/aws/aws-faast";
import { getAWSResources } from "./fixtures/util-aws";
import * as functions from "./fixtures/functions";
import { checkResourcesCleanedUp, sleep, title } from "./fixtures/util";

async function waitForLogGroupCreation(cloudwatch: CloudWatchLogs, logGroupName: string) {
    while (true) {
        await sleep(1000);
        try {
            const logResult = await cloudwatch
                .filterLogEvents({ logGroupName })
                .promise();
            const events = logResult.events ?? [];
            for (const event of events) {
                if (event.message!.match(/REPORT RequestId/)) {
                    return;
                }
            }
        } catch {}
    }
}

test.serial(title("aws", "garbage collects functions that are called"), async t => {
    // Idea behind this test: create a faast module and make a call. Then
    // cleanup while leaving the resources in place. Then create another faast
    // module and set its retention to 0, and use a synthetic gc worker to
    // observe and verify the garbage collector actually cleans up.
    const mod = await faastAws(functions, {
        gc: "off",
        mode: "queue",
        packageJson: {
            name: uuid(),
            dependencies: {
                tslib: "^1.9.1"
            }
        }
    });
    try {
        await mod.functions.hello("gc-test");
        const { cloudwatch } = mod.state.services;
        const { logGroupName } = mod.state.resources;
        await waitForLogGroupCreation(cloudwatch, logGroupName);
        await mod.cleanup({ deleteResources: false });

        // Create some work for gc to do by removing the log retention policy, gc
        // should add it back.
        const deleteRetentionPolicy = throttle({ concurrency: 1, retry: 5 }, () =>
            cloudwatch.deleteRetentionPolicy({ logGroupName }).promise()
        );
        await deleteRetentionPolicy();

        let deletedLayer = false;
        const { layer, FunctionName } = mod.state.resources;
        const mod2 = await faastAws(functions, {
            gc: "force",
            retentionInDays: 0,
            _gcWorker: async (work, services) => {
                switch (work.type) {
                    case "SetLogRetention":
                        // checkResourcesCleanedUp will verify the log group is
                        // deleted.
                        await defaultGcWorker(work, services);
                        break;
                    case "DeleteLayerVersion":
                        if (work.LayerName === layer!.LayerName) {
                            log.gc(`deleting layer ${work.LayerName}`);
                            await defaultGcWorker(work, services);
                            deletedLayer = true;
                        }
                        break;
                    case "DeleteResources":
                        if (work.resources.FunctionName === FunctionName) {
                            log.gc(`deleting resources for ${FunctionName}`);
                            await defaultGcWorker(work, services);
                        }
                }
            }
        });

        await mod2.cleanup();
        t.true(deletedLayer, "Deleted layer is true");
        await checkResourcesCleanedUp(t, await getAWSResources(mod, true));
    } finally {
        await mod.cleanup({ deleteResources: true, deleteCaches: true });
    }
});

test.serial(title("aws", "garbage collects functions that are never called"), async t => {
    const mod = await faastAws(functions, { gc: "off", mode: "queue" });
    try {
        await mod.cleanup({ deleteResources: false });
        const { FunctionName } = mod.state.resources;
        const mod2 = await faastAws(functions, {
            gc: "force",
            retentionInDays: 0,
            _gcWorker: async (work, services) => {
                switch (work.type) {
                    case "DeleteResources":
                        if (work.resources.FunctionName === FunctionName) {
                            log.gc(`deleting resources for ${FunctionName}`);
                            await defaultGcWorker(work, services);
                        }
                }
            }
        });

        await mod2.cleanup();
        await checkResourcesCleanedUp(t, await getAWSResources(mod, true));
    } finally {
        await mod.cleanup({ deleteResources: true, deleteCaches: true });
    }
});

test.skip(title("aws", "garbage collection caching"), async t => {
    {
        // Run a real gc so the build account doesn't accumulate garbage.
        const mod = await faastAws(functions, { gc: "force" });
        await mod.cleanup();
        t.is(await mod.state.gcPromise, "done");
    }

    {
        // Test the in-memory cache that prevents gc from multiple faast.js
        // instances from running at the same time.
        const mod = await faastAws(functions);
        await mod.cleanup();
        t.is(await mod.state.gcPromise, "skipped");
    }

    {
        // Test the persistent cache that prevents gc from running too often
        // even across processes.
        clearLastGc();
        const mod = await faastAws(functions);
        await mod.cleanup();
        t.is(await mod.state.gcPromise, "skipped");
    }
});
