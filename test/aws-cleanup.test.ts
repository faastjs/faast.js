import * as faast from "../src/faast";
import { checkResourcesCleanedUp, getAWSResources } from "./tests";
import test from "ava";

test("aws removes ephemeral resources", async t => {
    const func = await faast.faastify("aws", {}, "./functions", {
        mode: "queue",
        gc: false
    });
    await func.cleanup();
    await checkResourcesCleanedUp(t, await getAWSResources(func));
});

test("aws removes s3 buckets", async t => {
    const func = await faast.faastify("aws", {}, "./functions", {
        packageJson: "test/package.json",
        gc: false
    });
    await func.cleanup();
    await checkResourcesCleanedUp(t, await getAWSResources(func));
});
