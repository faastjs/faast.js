import * as sys from "child_process";
import * as fs from "fs";
import { tmpdir } from "os";
import * as path from "path";
import * as rimraf from "rimraf";
import { promisify } from "util";
import { CloudFunctionImpl, CloudImpl, CommonOptions } from "../cloudify";
import { log, warn } from "../log";
import { packer, PackerOptions, PackerResult, unzipInDir } from "../packer";
import { CommonOptionDefaults } from "../shared";
import {
    FunctionCall,
    FunctionReturn,
    FunctionReturnWithMetrics,
    ModuleWrapper,
    serializeCall
} from "../module-wrapper";
import * as immediateTrampolineFactory from "./immediate-trampoline";

const rmrf = promisify(rimraf);
const mkdir = promisify(fs.mkdir);
const exec = promisify(sys.exec);

export interface State {
    moduleWrapper: ModuleWrapper;
    options: Options;
    tempDir: string;
}

export interface Options extends CommonOptions {
    verbose?: boolean;
    silenceStdio?: boolean;
}

export const defaults: Options = {
    ...CommonOptionDefaults,
    silenceStdio: false
};

export const Impl: CloudImpl<Options, State> = {
    name: "immediate",
    initialize,
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

async function initialize(
    serverModule: string,
    nonce: string,
    options: Options = {}
): Promise<State> {
    const { verbose, silenceStdio = defaults.silenceStdio } = options;
    const moduleWrapper = new ModuleWrapper(require(serverModule), {
        verbose,
        silenceStdio
    });

    const tempDir = path.join(tmpdir(), "cloudify-" + nonce);
    log(`tempDir: ${tempDir}`);
    await mkdir(tempDir, { mode: 0o700, recursive: true });
    process.chdir(tempDir);

    const packerResult = await pack(serverModule, options);

    await unzipInDir(tempDir, packerResult.archive);
    const packageJsonFile = path.join(tempDir, "package.json");
    if (fs.existsSync(packageJsonFile)) {
        log(`Running 'npm install'`);
        await exec("npm install").then(x => {
            log(x.stdout);
            if (x.stderr) {
                warn(x.stderr);
            }
        });
    }

    return {
        moduleWrapper,
        options,
        tempDir
    };
}

async function pack(functionModule: string, options?: Options): Promise<PackerResult> {
    const popts: PackerOptions = options || {};
    return packer(immediateTrampolineFactory, functionModule, popts);
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
    process.chdir(state.tempDir);
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
    const { tempDir } = state;
    if (tempDir && tempDir.match(/\/cloudify-/) && fs.existsSync(tempDir)) {
        log(`Deleting temp dir ${tempDir}`);
        await rmrf(tempDir);
    }
}

async function stop(state: State) {
    log(`Stopping`);
    state.moduleWrapper.stop();
    log(`Stopping done`);
}
