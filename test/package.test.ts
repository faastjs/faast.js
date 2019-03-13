import test, { ExecutionContext } from "ava";
import { CommonOptions, faast, Provider, providers, faastAws } from "../index";
import * as funcs from "./fixtures/functionsPackage";
import { configs, title } from "./fixtures/util";
import uuid = require("uuid/v4");

async function testPackage(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
) {
    const opts = {
        ...options,
        gc: false,
        packageJson: {
            name: "package-test",
            version: "0.0.2",
            description: "package dependency test",
            repository: "foo",
            license: "ISC",
            dependencies: {
                "fs-extra": "^7.0.1",
                tslib: "^1.9.1"
            }
        },
        useDependencyCaching: false
    };
    const faastModule = await faast(provider, funcs, "./fixtures/functionsPackage", opts);
    const remote = faastModule.functions;
    try {
        t.is(await remote.isDir("."), true);
    } finally {
        await faastModule.cleanup();
    }
}

for (const provider of providers) {
    for (const config of configs) {
        test(
            title(provider, "package dependencies", config),
            testPackage,
            provider,
            config
        );
    }
}

test("remote aws package dependencies with lambda layer caching", async t => {
    const packageJson = {
        // Need unique name to avoid problems with communication between
        // concurrent tests, esp on aws node8 + node10 copies of the testsuite.
        name: uuid(),
        version: "0.0.2",
        description: "aws layer test",
        license: "ISC",
        dependencies: {
            tslib: "^1.9.1"
        }
    };
    const faastModule = await faastAws(funcs, "./fixtures/functionsPackage", {
        gc: false,
        packageJson
    });

    try {
        const faastModule2 = await faastAws(funcs, "./fixtures/functionsPackage", {
            gc: false,
            packageJson
        });

        t.not(faastModule.state.resources.layer, undefined);
        t.deepEqual(
            faastModule.state.resources.layer,
            faastModule2.state.resources.layer
        );
        await faastModule2.cleanup();
    } finally {
        await faastModule.cleanup({ deleteCaches: true });
    }
});
