import * as cloudify from "../src/cloudify";
import { checkResourcesCleanedUp, checkResourcesExist, getGoogleResources } from "./util";

test(
    "removes ephemeral resources",
    async () => {
        const cloud = cloudify.create("google");
        const func = await cloud.createFunction("./functions", { useQueue: true });
        checkResourcesExist(await getGoogleResources(func));
        await func.cleanup();
        checkResourcesCleanedUp(await getGoogleResources(func));
    },
    120 * 1000
);
