import test, { ExecutionContext } from "ava";
import { CommonOptions, faast, Provider, providers } from "../index";
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
        packageJson: "test/fixtures/package.json",
        useDependencyCaching: false
    };
    const cloudFunc = await faast(provider, funcs, "./fixtures/functionsPackage", opts);
    const remote = cloudFunc.functions;
    try {
        t.is(await remote.isDir("."), true);
    } finally {
        await cloudFunc.cleanup();
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
        name: uuid(),
        dependencies: {
            tslib: "^1.9.1"
        }
    };
    const cloudFunc = await faast("aws", funcs, "./fixtures/functionsPackage", {
        gc: false,
        packageJson
    });

    try {
        const cloudFunc2 = await faast("aws", funcs, "./fixtures/functionsPackage", {
            gc: false,
            packageJson
        });

        t.not(cloudFunc.state.resources.layer, undefined);
        t.deepEqual(cloudFunc.state.resources.layer, cloudFunc2.state.resources.layer);
        await cloudFunc2.cleanup();
    } finally {
        await cloudFunc.cleanup({ deleteCaches: true });
    }
});
