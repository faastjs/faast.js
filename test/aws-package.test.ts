import * as cloudify from "../src/cloudify";
import * as funcs from "./aws-package.functions";

export function checkFunctions(
    description: string,
    cloudProvider: string,
    options?: cloudify.CreateFunctionOptions<any>
) {
    describe(description, () => {
        let remote: cloudify.Promisified<typeof funcs>;
        let lambda: cloudify.CloudFunction<any>;

        beforeAll(async () => {
            try {
                const cloud = cloudify.create(cloudProvider);
                lambda = await cloud.createFunction("./functions", {
                    ...options,
                    timeout: 30,
                    memorySize: 512
                });
                remote = lambda.cloudifyAll(funcs);
            } catch (err) {
                console.error(err);
            }
        }, 90 * 1000);

        afterAll(async () => {
            await lambda.cleanup();
        }, 60 * 1000);
    });
}
