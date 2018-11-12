import { FunctionCall, ModuleWrapper } from "../module-wrapper";

export const filename = module.filename;

export const moduleWrapper = new ModuleWrapper();

export function trampoline(call: FunctionCall) {
    moduleWrapper.execute({ call, startTime: Date.now() });
}
