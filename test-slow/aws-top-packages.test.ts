import { AWS } from "../src/cloudify";
import { topPackages } from "./top-packages";
import * as functions from "./functions";
import { Funnel } from "../src/funnel";

describe("Install top 1000 npm packages with the most dependencies", async () => {
    const aws = new AWS();
    const funnel = new Funnel<string>(100);
    const promises: Promise<string>[] = [];
    let results: string[] = [];

    beforeAll(async () => {
        for (const topPackage of topPackages) {
            promises.push(
                funnel.push(async () => {
                    const lambda = await aws.createFunction("./functions", {
                        useQueue: false,
                        packageJson: { dependencies: { [topPackage]: "*" } }
                    });
                    const remoteHello = lambda.cloudify(functions.hello);
                    const result = await remoteHello(topPackage);
                    expect(result).toBe(functions.hello(topPackage));
                    return topPackage;
                })
            );
        }
        results = await Promise.all(promises);
    });

    for (const result of results) {
        test(`Package '${result}'`, () => {});
    }
});
