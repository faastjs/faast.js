import { ModuleWrapper, FunctionCall } from "../trampoline";

export const filename = module.filename;

export const moduleWrapper = new ModuleWrapper();

export function trampoline(call: FunctionCall) {
    moduleWrapper.execute({ call, startTime: Date.now() });
}
