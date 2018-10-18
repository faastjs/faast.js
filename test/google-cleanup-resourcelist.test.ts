import * as cloudify from "../src/cloudify";
import { checkResourcesCleanedUp, checkResourcesExist, getGoogleResources } from "./util";

test(
    "removes ephemeral resources from a resource list",
    async () => {
        const cloud = cloudify.create("google");
        const func = await cloud.createFunction("./functions", { mode: "queue" });
        checkResourcesExist(await getGoogleResources(func));
        const resourceList = await func.stop();
        await cloud.cleanupResources(resourceList);
        checkResourcesCleanedUp(await getGoogleResources(func));
    },
    180 * 1000
);
