import { FunctionCallSerialized, Wrapper } from "../wrapper";

export const filename = module.filename;

export function makeTrampoline(wrapper: Wrapper) {
    function trampoline(sCall: FunctionCallSerialized) {
        wrapper.execute({ sCall, startTime: Date.now() });
    }
    return { trampoline };
}
