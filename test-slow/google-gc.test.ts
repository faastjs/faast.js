import { faastify } from "../src/faast";
import {
    checkResourcesCleanedUp,
    getGoogleResources,
    record,
    contains
} from "../test/tests";
import * as functions from "../test/functions";
import { GoogleResources, GoogleServices } from "../src/google/google-faast";

test(
    "garbage collector works for functions that are called",
    async () => {
        // Idea behind this test: create a faast function and make a call.
        // Then call stop() to leave the resources in place. Then create another
        // function and set its retention to 0, and use a recorder to observe what
        // its garbage collector cleans up. Verify the first function's resources
        // would be cleaned up, which shows that the garbage collector did its job.
        const func = await faastify("google", functions, "../test/functions", {
            mode: "queue"
        });
        await func.functions.hello("gc-test");
        await func.stop();
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
        expect(
            gcRecorder.recordings.find(r => contains(r.args[1], resources))
        ).toBeDefined();
        await func.cleanup();
    },
    180 * 1000
);

test(
    "garbage collector works for functions that are never called",
    async () => {
        const func = await faastify("google", functions, "../test/functions", {
            mode: "queue"
        });
        await func.stop();
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
        expect(
            gcRecorder.recordings.find(r => contains(r.args[1], resources))
        ).toBeDefined();
        await func.cleanup();
    },
    180 * 1000
);
