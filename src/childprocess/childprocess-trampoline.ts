import * as process from "process";
import { ModuleWrapper, FunctionReturn } from "../trampoline";
import { ProcessFunctionCall } from "./childprocess-cloudify";

export const moduleWrapper = new ModuleWrapper();

process.on("message", async ({ call, serverModule, timeout }: ProcessFunctionCall) => {
    const executionStart = Date.now();

    const timer = setTimeout(() => {
        const timeoutReturn: FunctionReturn = moduleWrapper.createErrorResponse(
            new Error(`Function timed out after ${timeout}s`),
            call,
            executionStart
        );
        process.send!(timeoutReturn);
        process.disconnect();
        process.exit();
    }, timeout * 1000);

    try {
        const mod = require(serverModule);
        if (!mod) {
            throw new Error(`Could not find module '${serverModule}'`);
        }
        moduleWrapper.register(mod);
        const ret = await moduleWrapper.execute(call, executionStart);
        process.send!(ret);
    } catch (err) {
        console.error(err);
    } finally {
        clearTimeout(timer);
        process.disconnect();
    }
});
