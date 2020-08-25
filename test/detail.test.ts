import test, { ExecutionContext } from "ava";
import { CommonOptions, faast, Provider, providers } from "../index";
import * as funcs from "./fixtures/functions";
import { configs, noValidateConfigs, title, toArray } from "./fixtures/util";

async function testDetail(
    t: ExecutionContext,
    provider: Provider,
    options: CommonOptions
) {
    const opts: CommonOptions = {
        timeout: 60,
        gc: "off",
        description: t.title,
        ...options
    };
    const faastModule = await faast(provider, funcs, opts);
    const remote = faastModule.functionsDetail;

    try {
        t.is((await remote.hello("Andy")).value, "Hello Andy!");
        t.is( (await remote.identityString("你好")).value, "你好");
        t.is( (await remote.identityNum(42)).value, 42);
        const elements = ["bar", "baz"];
        t.deepEqual((await toArray(remote.generator(elements))).map(elem => elem.value), elements);
        t.deepEqual((await toArray(remote.asyncGenerator(elements))).map(elem => elem.value), elements);
        if(provider === "aws") {
            const detail = await remote.hello("there");
            t.truthy(detail.logUrl);
            t.truthy(detail.instanceId);
            t.truthy(detail.executionId);
            const regex = `^https:\/\/.*\.console\.aws\.amazon\.com\/cloudwatch\/.*group=.*stream=.*filter=%22${detail.executionId}%22$`
            t.regex(detail.logUrl!, new RegExp(regex));
        }
    } finally {
        await faastModule.cleanup();
    }
}

for (const provider of providers) {
    for (const config of [...configs, ...noValidateConfigs]) {
        test(title(provider, `detailed calls`, config), testDetail, provider, config);
    }
}
