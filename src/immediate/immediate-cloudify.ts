import { CloudFunctionImpl, CloudImpl, CommonOptions, Logger } from "../cloudify";
import { Funnel } from "../funnel";
import { warn } from "../log";
import { PackerResult } from "../packer";
import {
    FunctionCall,
    FunctionReturn,
    ModuleWrapper,
    serializeCall
} from "../trampoline";
import * as process from "process";

export interface State {
    callFunnel: Funnel<FunctionReturn>;
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
    setConcurrency,
    setLogger
};

async function initialize(serverModule: string, options: Options = {}): Promise<State> {
    const moduleWrapper = new ModuleWrapper();
    moduleWrapper.register(require(serverModule));
    if (options.memorySize) {
        warn(`cloudify type 'immediate' does not support memorySize option, ignoring.`);
    }
    if (options.timeout) {
        warn(`cloudify type 'immediate' does not support timeout option, ignoring.`);
    }

    return {
        callFunnel: new Funnel<FunctionReturn>(),
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

function callFunction(state: State, call: FunctionCall): Promise<FunctionReturn> {
    const scall = JSON.parse(serializeCall(call));
    return state.callFunnel.push(async () => {
        const start = Date.now();
        try {
            return state.moduleWrapper.execute(scall);
        } catch (err) {
            return state.moduleWrapper.createErrorResponse(err, scall, start);
        }
    });
}

async function cleanup(state: State): Promise<void> {
    await stop(state);
}

async function stop(state: State): Promise<string> {
    state.callFunnel.clearPending();
    await Promise.all(state.callFunnel.executing());
    return "";
}

async function setConcurrency(
    state: State,
    maxConcurrentExecutions: number
): Promise<void> {
    state.callFunnel.setMaxConcurrency(maxConcurrentExecutions);
}

function setLogger(_state: State, _logger: Logger | undefined) {}
