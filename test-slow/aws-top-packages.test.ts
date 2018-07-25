import { AWS } from "../src/cloudify";
import { topPackages } from "./top-packages";
import * as functions from "./functions";
import { Funnel } from "../src/funnel";

describe("Sanity checks for top packages", () => {});

describe("Install top 1000 npm packages with the most dependencies", async () => {
    const aws = new AWS();
    const funnel = new Funnel<void>(500);
    const promises: Promise<void>[] = [];
    const results: { [key in string]: string | Error } = {};

    beforeAll(async () => {
        for (const topPackage of topPackages) {
            promises.push(
                funnel.push(async () => {
                    try {
                        const lambda = await aws.createFunction("./functions", {
                            useQueue: false,
                            cloudSpecific: { useDependencyCaching: false },
                            packageJson: { dependencies: { [topPackage]: "*" } }
                        });
                        await lambda.cleanup();
                        results[topPackage] = topPackage;
                    } catch (err) {
                        results[topPackage] = err;
                    }
                })
            );
        }
        await Promise.all(promises);
    }, 600 * 1000);

    for (const pkg of topPackages) {
        test(`Package '${pkg}'`, () => {
            expect(results[pkg]).toBe(pkg);
        });
    }
});
