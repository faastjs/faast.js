import * as faast from "../src/faast";
import { checkResourcesCleanedUp, getAWSResources } from "./tests";

describe("aws cleanup", () => {
    test(
        "removes ephemeral resources",
        async () => {
            const func = await faast.faastify("aws", {}, "./functions", {
                mode: "queue",
                gc: false
            });
            await func.cleanup();
            await checkResourcesCleanedUp(await getAWSResources(func));
        },
        30 * 1000
    );

    test(
        "removes s3 buckets",
        async () => {
            const func = await faast.faastify("aws", {}, "./functions", {
                packageJson: "test/package.json",
                gc: false
            });
            await func.cleanup();
            await checkResourcesCleanedUp(await getAWSResources(func));
        },
        90 * 1000
    );
});
