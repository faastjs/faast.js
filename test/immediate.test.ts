import { cloudify } from "../src/cloudify";
import * as funcs from "./functions";
import { checkFunctions } from "./tests";

checkFunctions("cloudify-immediate basic functions", "immediate", {});

checkFunctions("cloudify-immediate with childprocess basic functions", "immediate", {
    childProcess: true
});

test("cloudify-immediate stdout and stderr with child process", async () => {
    const { remote, cloudFunc } = await cloudify("immediate", funcs, "./functions");
    await remote.consoleLog("Remote console.log output");
    await remote.consoleWarn("Remote console.log output");
    // XXX add checks for console.log/warn output
    await cloudFunc.cleanup();
});

test("cloudify-immediate cleanup stops executions", async () => {
    const { remote, cloudFunc } = await cloudify("immediate", funcs, "./functions");
    let done = 0;
    remote
        .hello("there")
        .catch(_ => {})
        .then(_ => done++);
    remote
        .delay(10)
        .catch(_ => {})
        .then(_ => done++);
    await cloudFunc.cleanup();
    expect(done).toBe(2);
});
