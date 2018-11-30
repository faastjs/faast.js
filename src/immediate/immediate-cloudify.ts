import * as sys from "child_process";
import * as fs from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { promisify } from "util";
import { CloudFunctionImpl, CloudImpl, CommonOptions } from "../cloudify";
import { info, warn } from "../log";
import {
    FunctionCall,
    FunctionReturn,
    FunctionReturnWithMetrics,
    ModuleWrapper,
    serializeCall
} from "../module-wrapper";
import { packer, PackerOptions, PackerResult, unzipInDir } from "../packer";
import { CommonOptionDefaults, rmrf } from "../shared";
import * as immediateTrampolineFactory from "./immediate-trampoline";
import { Writable } from "stream";
import { makeRe } from "minimatch";

const mkdir = promisify(fs.mkdir);
const exec = promisify(sys.exec);

export interface State {
    moduleWrappers: ModuleWrapper[];
    getModuleWrapper: () => Promise<ModuleWrapper>;
    logStreams: Writable[];
    options: Options;
    tempDir: string;
    logUrl: string;
}

export interface Options extends CommonOptions {}

export const defaults: Options = {
    ...CommonOptionDefaults,
    concurrency: 10,
    memorySize: 512,
    timeout: 300
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
    stop,
    logUrl
};

async function initialize(
    serverModule: string,
    nonce: string,
    options: Options = {}
): Promise<State> {
    const moduleWrappers: ModuleWrapper[] = [];
    const logStreams: Writable[] = [];

    const tempDir = path.join(tmpdir(), "cloudify-" + nonce);
    info(`tempDir: ${tempDir}`);
    await mkdir(tempDir, { recursive: true });
    const logDir = path.join(tempDir, "logs");
    await mkdir(logDir, { recursive: true });
    const log = `file://${logDir}`;

    info(`logURL: ${log}`);

    const getModuleWrapper = async () => {
        const idleWrapper = moduleWrappers.find(wrapper => wrapper.executing === false);
        if (idleWrapper) {
            return idleWrapper;
        }
        let logStream: Writable;
        let childlog = (msg: string) => {
            logStream.write(msg);
            logStream.write("\n");
        };
        try {
            const logFile = path.join(logDir, `${moduleWrappers.length}.log`);
            info(`Creating write stream ${logFile}`);
            logStream = fs.createWriteStream(logFile);
            logStreams.push(logStream);
            await new Promise(resolve => logStream.on("open", resolve));
        } catch (err) {
            warn(`ERROR: Could not create log`);
            warn(err);
            childlog = console.log;
        }
        const moduleWrapper = new ModuleWrapper(require(serverModule), {
            log: childlog,
            useChildProcess: options.childProcess || false,
            childProcessMemoryLimitMb: options.memorySize || defaults.memorySize,
            childProcessTimeout: options.timeout || defaults.timeout,
            childDir: tempDir
        });
        moduleWrappers.push(moduleWrapper);
        return moduleWrapper;
    };

    const packerResult = await pack(serverModule, options);

    await unzipInDir(tempDir, packerResult.archive);
    const packageJsonFile = path.join(tempDir, "package.json");
    if (fs.existsSync(packageJsonFile)) {
        info(`Running 'npm install'`);
        await exec("npm install").then(x => {
            info(x.stdout);
            if (x.stderr) {
                warn(x.stderr);
            }
        });
    }

    return {
        moduleWrappers,
        getModuleWrapper,
        logStreams,
        options,
        tempDir,
        logUrl: log
    };
}

export function logUrl(state: State) {
    return state.logUrl;
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
    const moduleWrapper = await state.getModuleWrapper();
    returned = await moduleWrapper.execute({ call: scall, startTime });

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
        info(`Deleting temp dir ${tempDir}`);
        await rmrf(tempDir);
    }
}

async function stop(state: State) {
    info(`Stopping`);
    await Promise.all(state.moduleWrappers.map(wrapper => wrapper.stop()));
    await Promise.all(
        state.logStreams.map(stream => new Promise(resolve => stream.end(resolve)))
    );
    state.logStreams = [];
    state.moduleWrappers = [];
    info(`Stopping done`);
}
