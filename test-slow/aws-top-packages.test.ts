import { AWS } from "../src/cloudify";
import { topPackages, topPackagesAll, topPackagesFailures } from "./top-packages";
import * as functions from "../test/functions";
import { Funnel } from "../src/funnel";

type Results = { [key in string]: string | Error };

function testPackages(packages: string[]) {
    async function installPackages() {
        const aws = new AWS();
        const funnel = new Funnel<void>(500);
        const promises: Promise<void>[] = [];
        const results: Results = {};

        for (const pkg of packages) {
            promises.push(
                funnel.push(async () => {
                    try {
                        const lambda = await aws.createFunction("../test/functions", {
                            mode: "https",
                            useDependencyCaching: false,
                            packageJson: { dependencies: { [pkg]: "*" } }
                        });
                        await lambda.cleanup();
                        results[pkg] = pkg;
                    } catch (err) {
                        results[pkg] = err;
                    }
                })
            );
        }
        await Promise.all(promises);
        return results;
    }

    describe(`Install npm packages with the most dependencies`, async () => {
        let results: Results;

        beforeAll(async () => {
            results = await installPackages();
        }, 600 * 1000);

        for (const pkg of packages) {
            test(`Package '${pkg}'`, () => {
                expect(results[pkg]).toBe(pkg);
            });
        }
    });
}

// funnel(500) => 468s
// funnel(900) => 504s
testPackages(topPackages);
// testPackages(topPackagesFailures);
