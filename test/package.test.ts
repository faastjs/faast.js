import test, { ExecutionContext } from "ava";
import { CommonOptions, faast, Provider, providers } from "../index";
import * as funcs from "./fixtures/functionsPackage";
import { configs, title } from "./fixtures/util";

async function testPackage(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
) {
    const opts = { gc: false, ...options };
    const cloudFunc = await faast(provider, funcs, "./fixtures/functionsPackage", opts);
    const remote = cloudFunc.functions;

    try {
        t.is(await remote.runFsExtra(), true);
    } finally {
        await cloudFunc.cleanup();
    }
}

for (const provider of providers) {
    for (const config of configs) {
        test(title(provider, "package dependencies", config), testPackage, provider, {
            ...config,
            packageJson: "test/fixtures/package.json",
            useDependencyCaching: false
        });
    }
}
