import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";
import { checkFunctions } from "./tests";

checkFunctions("cloudify-immediate basic functions", "immediate", {});

test("cloudify-immediate cleanup waits for all executions to exit", async () => {
    const cloud = cloudify.create("immediate");
    const func = await cloud.createFunction("./functions");
    const immediate = func.cloudifyModule(funcs);
    let done = 0;
    immediate.hello("there").then(_ => done++);
    immediate.delay(10).then(_ => done++);
    await func.cleanup();
    expect(done).toBe(2);
});
