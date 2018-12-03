import { FunctionCall, Wrapper } from "../wrapper";

export const filename = module.filename;

export function makeTrampoline(wrapper: Wrapper) {
    function trampoline(call: FunctionCall) {
        wrapper.execute({ call, startTime: Date.now() });
    }
    return { trampoline };
}
