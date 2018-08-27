import { checkFunctions, checkLogs } from "./tests";
import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";

checkFunctions("cloudify-process basic functions", "process", {});

checkLogs("cloudify-process logs", "process", 0);

test("cloudify-process cleanup waits for all child processes to exit", async () => {
    const cloud = cloudify.create("process");
    const func = await cloud.createFunction("./functions");
    // func.setLogger(console.log);
    const process = func.cloudifyAll(funcs);
    process.hello("there").catch(_ => {});
    process.delay(2000).catch(_ => {});
    expect(func.getState().resources.childProcesses.size).toBe(2);
    await func.cleanup();
    expect(func.getState().resources.childProcesses.size).toBe(0);
});
