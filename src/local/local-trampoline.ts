import { FunctionCall, Wrapper } from "../wrapper";

export const filename = module.filename;

export function makeTrampoline(moduleWrapper: Wrapper) {
    function trampoline(call: FunctionCall) {
        moduleWrapper.execute({ call, startTime: Date.now() });
    }
    return { trampoline };
}
