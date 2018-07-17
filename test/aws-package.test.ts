import * as cloudify from "../src/cloudify";
import * as funcs from "./aws-package.functions";

export function main(description: string, options?: cloudify.CreateFunctionOptions<any>) {
    describe(description, () => {
        let remote: cloudify.Promisified<typeof funcs>;
        let lambda: cloudify.CloudFunction<any>;

        beforeAll(async () => {
            try {
                const cloud = cloudify.create("aws");
                lambda = await cloud.createFunction("./aws-package.functions", {
                    ...options
                });
                remote = lambda.cloudifyAll(funcs);
            } catch (err) {
                console.error(err);
            }
        }, 90 * 1000);

        test(
            "npm",
            async () => {
                let response = await remote.exec("npm -v");
                console.log(response);
                response = await remote.exec("mkdir /tmp/build");
                console.log(response);
                response = await remote.exec("cp index.js package.json /tmp/build");
                console.log(response);

                // response = await remote.exec(
                //     "export HOME=/tmp && npm install --prefix=/tmp/build"
                // );
                // console.log(response);
                response = await remote.exec(
                    "export HOME=/tmp && npm install -g yarn --prefix=/tmp"
                );
                response = await remote.exec(
                    "export HOME=/tmp && yarn install --prefix=/tmp/build"
                );
                console.log(response);
                response = await remote.exec("du -h /tmp/build");
                console.log(response);
            },
            300 * 1000
        );

        afterAll(async () => {
            await lambda.cleanup();
        }, 60 * 1000);
    });
}

main("Test AWS lambda with package.json", {
    timeout: 300,
    memorySize: 1024,
    useQueue: false,
    cloudSpecific: {
        packerOptions: { packageJson: "test/ex/package.json" }
    }
});
