import * as cloudify from "../src/cloudify";
import * as funcs from "./functions";

test("cleanup waits for all child processes to exit", async () => {
    const cloud = cloudify.create("process");
    const func = await cloud.createFunction("./functions", { useQueue: true });
    const process = func.cloudifyAll(funcs);
    process.hello("there");
    process.delay(2000);
    expect(func.getState().resources.childProcesses.size).toBe(2);
    await func.cleanup();
    expect(func.getState().resources.childProcesses.size).toBe(0);
});
