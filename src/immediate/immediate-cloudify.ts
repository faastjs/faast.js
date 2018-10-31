import {
    CloudFunctionImpl,
    CloudImpl,
    CommonOptions,
    CommonOptionDefaults
} from "../cloudify";
import { warn } from "../log";
import { PackerResult } from "../packer";
import { sleep } from "../shared";
import {
    FunctionCall,
    FunctionReturn,
    FunctionReturnWithMetrics,
    ModuleWrapper,
    serializeCall
} from "../trampoline";

export interface State {
    moduleWrapper: ModuleWrapper;
    options: Options;
}

export interface Options extends CommonOptions {}

export const defaults: CommonOptions = {
    ...CommonOptionDefaults
};

export const Impl: CloudImpl<Options, State> = {
    name: "immediate",
    initialize,
    cleanupResources,
    pack,
    getFunctionImpl,
    defaults
};

export const FunctionImpl: CloudFunctionImpl<State> = {
    name: "immediate",
    callFunction,
    cleanup,
    stop
};

async function initialize(serverModule: string, options: Options = {}): Promise<State> {
    const moduleWrapper = new ModuleWrapper({ verbose: false });
    moduleWrapper.register(require(serverModule));
    if (options.memorySize) {
        warn(`cloudify type 'immediate' does not support memorySize option, ignoring.`);
    }
    if (options.timeout) {
        warn(`cloudify type 'immediate' does not support timeout option, ignoring.`);
    }
    return {
        moduleWrapper,
        options
    };
}

async function cleanupResources(_resources: string): Promise<void> {}

async function pack(_functionModule: string, _options?: Options): Promise<PackerResult> {
    throw new Error("Pack not supported for immediate-cloudify");
}

function getFunctionImpl(): CloudFunctionImpl<State> {
    return FunctionImpl;
}

async function callFunction(
    state: State,
    call: FunctionCall
): Promise<FunctionReturnWithMetrics> {
    const scall = JSON.parse(serializeCall(call));
    const startTime = Date.now();
    let returned: FunctionReturn;
    returned = await state.moduleWrapper.execute({ call: scall, startTime });
    return {
        returned,
        rawResponse: {},
        localRequestSentTime: startTime,
        remoteResponseSentTime: returned.remoteExecutionEndTime!,
        localEndTime: Date.now()
    };
}

async function cleanup(state: State): Promise<void> {
    await stop(state);
}

async function stop(_: State): Promise<string> {
    await sleep(0);
    return "";
}
