import test, { ExecutionContext } from "ava";
import { CommonOptions, faast, Provider, providers } from "../index";
import { title } from "./fixtures/util";
import * as funcs from "./fixtures/worker";

async function testWorker(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
) {
    const opts: CommonOptions = {
        timeout: 10,
        gc: "off",
        ...options
    };
    const faastModule = await faast(provider, funcs, opts);
    const remote = faastModule.functions;

    try {
        t.is(await remote.runWorker("All"), "All done");
    } finally {
        await faastModule.cleanup();
    }
}

for (const provider of providers.filter(p => p !== "google")) {
    for (const config of [{ childProcess: true }, { childProcess: false }]) {
        test(title(provider, `node worker thread`, config), testWorker, provider, config);
    }
}
