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
        const expected = { message: /cannot be serialized/ };
        await t.throwsAsync(remote.promiseArg(Promise.resolve()), expected);
        await t.throwsAsync(
            remote.identityFunction(() => {}),
            expected
        );
        await t.throwsAsync(remote.functionReturn(), expected);
        await t.throwsAsync(remote.identityClass(new funcs.Cls()), expected);
        await t.throwsAsync(remote.classReturn(), expected);
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
