import * as faast from "../src/faast";
import {
    checkResourcesCleanedUp,
    checkResourcesExist,
    getGoogleResources
} from "./tests";

describe("google cleanup", () => {
    test(
        "removes ephemeral resources",
        async () => {
            const cloud = faast.create("google");
            const func = await cloud.createFunction("./functions", { mode: "queue" });
            checkResourcesExist(await getGoogleResources(func));
            await func.cleanup();
            checkResourcesCleanedUp(await getGoogleResources(func));
        },
        180 * 1000
    );
});
