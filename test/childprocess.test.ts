import { checkFunctions, checkLogs } from "./tests";
import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";

checkFunctions("cloudify childprocess basic functions", "childprocess", {});

checkLogs("cloudify childprocess logs", "childprocess");

test("cloudify childprocess cleanup waits for all child processes to exit", async () => {
    const cloud = cloudify.create("childprocess");
    const func = await cloud.createFunction("./functions");
    // func.setLogger(console.log);
    const process = func.cloudifyModule(funcs);
    process.hello("there").catch(_ => {});
    process.delay(2000).catch(_ => {});
    expect(func.state.resources.childProcesses.size).toBe(2);
    await func.cleanup();
    expect(func.state.resources.childProcesses.size).toBe(0);
});
