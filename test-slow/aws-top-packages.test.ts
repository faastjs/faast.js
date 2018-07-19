import { AWS } from "../src/cloudify";
import { topPackages } from "./top-packages";
import * as functions from "./functions";
import { Funnel } from "../src/funnel";

describe("Install top 1000 npm packages with the most dependencies", async () => {
    const aws = new AWS();

    const funnel = new Funnel<void>(100);
    const promises = [];
    for (const topPackage of topPackages) {
        promises.push(
            funnel.push(async () => {
                test(
                    `Package '${topPackage}'`,
                    async () => {
                        const lambda = await aws.createFunction("./functions", {
                            useQueue: false,
                            packageJson: { dependencies: { [topPackage]: "*" } }
                        });
                        const remoteHello = lambda.cloudify(functions.hello);
                        expect(remoteHello(topPackage)).toBe(functions.hello(topPackage));
                    },
                    60 * 1000
                );
            })
        );
    }
    await Promise.all(promises);
});
