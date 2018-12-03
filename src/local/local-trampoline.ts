import { FunctionCall, ModuleWrapper } from "../module-wrapper";

export const filename = module.filename;

export function makeTrampoline(moduleWrapper: ModuleWrapper) {
    function trampoline(call: FunctionCall) {
        moduleWrapper.execute({ call, startTime: Date.now() });
    }
    return { trampoline };
}
