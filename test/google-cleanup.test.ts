import * as faast from "../src/faast";
import {
    checkResourcesCleanedUp,
    checkResourcesExist,
    getGoogleResources
} from "./tests";
import test from "ava";

test("google cleanup removes ephemeral resources", async t => {
    const func = await faast.faastify("google", {}, "./functions", {
        mode: "queue"
    });
    checkResourcesExist(t, await getGoogleResources(func));
    await func.cleanup();
    checkResourcesCleanedUp(t, await getGoogleResources(func));
});
