import { CloudFunctionImpl, CloudImpl, CommonOptions } from "../cloudify";
import { Funnel } from "../funnel";
import { warn } from "../log";
import { PackerResult } from "../packer";
import {
    FunctionCall,
    FunctionReturn,
    ModuleWrapper,
    serializeCall,
    FunctionReturnWithMetrics,
    createErrorResponse
} from "../trampoline";
import { sleep } from "../shared";

export interface State {
    callFunnel: Funnel<FunctionReturnWithMetrics>;
    moduleWrapper: ModuleWrapper;
    options: Options;
}

export interface Options extends CommonOptions {}

export const Impl: CloudImpl<Options, State> = {
    name: "immediate",
    initialize,
    cleanupResources,
    pack,
    getFunctionImpl
};

export const FunctionImpl: CloudFunctionImpl<State> = {
    name: "immediate",
    callFunction,
    cleanup,
    stop,
    setConcurrency
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
    const { concurrency = 500 } = options;
    return {
        callFunnel: new Funnel<FunctionReturnWithMetrics>(concurrency),
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

function callFunction(
    state: State,
    call: FunctionCall
): Promise<FunctionReturnWithMetrics> {
    const scall = JSON.parse(serializeCall(call));
    return state.callFunnel.push(async () => {
        const startTime = Date.now();
        let returned: FunctionReturn;
        try {
            returned = await state.moduleWrapper.execute({ call: scall, startTime });
        } catch (err) {
            returned = createErrorResponse(err, { call: scall, startTime });
        }
        return {
            returned,
            rawResponse: {},
            localRequestSentTime: startTime,
            remoteResponseSentTime: returned.remoteExecutionEndTime!,
            localEndTime: Date.now()
        };
    });
}

async function cleanup(state: State): Promise<void> {
    await stop(state);
}

async function stop(state: State): Promise<string> {
    state.callFunnel.clear();
    await sleep(0);
    return "";
}

async function setConcurrency(
    state: State,
    maxConcurrentExecutions: number
): Promise<void> {
    state.callFunnel.setMaxConcurrency(maxConcurrentExecutions);
}
