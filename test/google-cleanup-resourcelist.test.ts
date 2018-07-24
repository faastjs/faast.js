import * as cloudify from "../src/cloudify";
import { checkResourcesCleanedUp, checkResourcesExist, getResources } from "./util";

test(
    "removes ephemeral resources from a resource list",
    async () => {
        const cloud = cloudify.create("google");
        const func = await cloud.createFunction("./functions", { useQueue: true });
        checkResourcesExist(await getResources(func));
        const resourceList = func.getResourceList();
        await cloud.cleanupResources(resourceList);
        checkResourcesCleanedUp(await getResources(func));
    },
    120 * 1000
);
