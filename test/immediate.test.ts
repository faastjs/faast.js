import { cloudify } from "../src/cloudify";
import * as funcs from "./functions";
import { checkFunctions } from "./tests";

checkFunctions("cloudify-immediate basic functions", "immediate", {});

checkFunctions("cloudify-immediate with childprocess basic functions", "immediate", {
    childProcess: true
});

test("cloudify-immediate console.log and console.warn with child process", async () => {
    const messages: string[] = [];
    const log = (msg: string) => {
        if (msg[msg.length - 1] === "\n") {
            msg = msg.slice(0, msg.length - 1);
        }
        //        console.log(msg)
        messages.push(msg);
    };
    const { remote, cloudFunc } = await cloudify("immediate", funcs, "./functions", {
        childProcess: true,
        // verbose: true,
        log,
    });
    await remote.consoleLog("Remote console.log output");
    await remote.consoleWarn("Remote console.warn output");
    await remote.consoleError("Remote console.error output");

    expect(messages.find(m => m === "Remote console.log output")).toBeDefined();
    expect(messages.find(m => m === "Remote console.warn output")).toBeDefined();
    expect(messages.find(m => m === "Remote console.error output")).toBeDefined();

    await cloudFunc.cleanup();
    // await cloudFunc.stop();
});

test("cloudify-immediate cleanup stops executions", async () => {
    const { remote, cloudFunc } = await cloudify("immediate", funcs, "./functions");
    let done = 0;
    remote
        .hello("there")
        .catch(_ => { })
        .then(_ => done++);
    remote
        .delay(10)
        .catch(_ => { })
        .then(_ => done++);
    await cloudFunc.cleanup();
    expect(done).toBe(2);
});
