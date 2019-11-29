import test, { ExecutionContext } from "ava";
import { CommonOptions, faast, Provider, providers } from "../index";
import * as funcs from "./fixtures/functions";
import { configs, title } from "./fixtures/util";

async function testUnsupported(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
) {
    const opts: CommonOptions = { timeout: 30, gc: "off", ...options };
    const faastModule = await faast(provider, funcs, opts);
    const remote = faastModule.functions;

    try {
        await t.throwsAsync(remote.promiseArg(Promise.resolve()), /cannot be serialized/);
        await t.throwsAsync(
            remote.identityFunction(() => {}),
            /cannot be serialized/
        );
        await t.throwsAsync(remote.functionReturn(), /cannot be serialized/);
        await t.throwsAsync(
            remote.identityClass(new funcs.Cls()),
            /cannot be serialized/
        );
        await t.throwsAsync(remote.classReturn(), /cannot be serialized/);
    } finally {
        await faastModule.cleanup();
    }
}
for (const provider of providers) {
    for (const config of configs) {
        test(
            title(provider, `unsupported arguments`, config),
            testUnsupported,
            provider,
            config
        );
    }
}
