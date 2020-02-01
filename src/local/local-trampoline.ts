/**
 * This file is unused at runtime, but needs to exist to allow webpack to work
 * properly for local mode.
 */

import { FunctionCall, Wrapper } from "../wrapper";

export const filename = module.filename;

export function makeTrampoline(wrapper: Wrapper) {
    function trampoline(call: FunctionCall) {
        wrapper.execute({ call, startTime: Date.now() }, { onMessage: async () => {} });
    }
    return { trampoline };
}
