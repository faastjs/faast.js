import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";
import { checkFunctions } from "./tests";

checkFunctions("cloudify-immediate basic functions", "immediate", {
    // Remove these options to avoid unsupported warning.
    memorySize: undefined,
    timeout: undefined
});

test("cloudify-immediate cleanup stops executions", async () => {
    const cloud = cloudify.create("immediate");
    const func = await cloud.createFunction("./functions");
    const immediate = func.cloudifyModule(funcs);
    let done = 0;
    immediate
        .hello("there")
        .catch(_ => {})
        .then(_ => done++);
    immediate
        .delay(10)
        .catch(_ => {})
        .then(_ => done++);
    await func.cleanup();
    expect(done).toBe(2);
});
