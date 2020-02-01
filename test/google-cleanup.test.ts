import test, { ExecutionContext } from "ava";
import { faastGoogle, log } from "../index";
import { checkResourcesCleanedUp, keysOf } from "./fixtures/util";
import { getGoogleResources } from "./fixtures/util-google";
import * as funcs from "./fixtures/functions";

export function checkResourcesExist<T extends object>(t: ExecutionContext, resources: T) {
    t.true(keysOf(resources).length === 5);
    for (const key of keysOf(resources)) {
        t.truthy(resources[key]);
    }
}

test("remote google cleanup removes ephemeral resources", async t => {
    try {
        const func = await faastGoogle(funcs, {
            mode: "queue",
            gc: "off"
        });
        checkResourcesExist(t, await getGoogleResources(func));
        await func.cleanup();
        checkResourcesCleanedUp(t, await getGoogleResources(func));
    } catch (err) {
        log.warn(`google cleanup error: ${err.stack}`);
        throw err;
    }
});
