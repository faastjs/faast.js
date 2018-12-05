import * as sys from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { Writable } from "stream";
import { promisify } from "util";
import { CloudFunctionImpl, CloudImpl, CommonOptions } from "../cloudify";
import { info, logGc, warn } from "../log";
import {
    FunctionCall,
    FunctionReturn,
    FunctionReturnWithMetrics,
    Wrapper,
    serializeCall
} from "../wrapper";
import { packer, PackerOptions, PackerResult, unzipInDir } from "../packer";
import { CommonOptionDefaults, hasExpired } from "../shared";
import { mkdir, readdir, stat, exists, rmrf, createWriteStream } from "../fs";
import * as localTrampolineFactory from "./local-trampoline";

const exec = promisify(sys.exec);

export interface State {
    wrappers: Wrapper[];
    getWrapper: () => Promise<Wrapper>;
    logStreams: Writable[];
    tempDir: string;
    logUrl: string;
    gcPromise?: Promise<void>;
}

export interface Options extends CommonOptions {}

export const defaults: Options = {
    ...CommonOptionDefaults,
    concurrency: 10,
    memorySize: 512,
    timeout: 300
};

export const Impl: CloudImpl<Options, State> = {
    name: "local",
    initialize,
    pack,
    getFunctionImpl,
    defaults
};

export const FunctionImpl: CloudFunctionImpl<State> = {
    name: "local",
    callFunction,
    cleanup,
    stop,
    logUrl
};

async function initialize(
    serverModule: string,
    nonce: string,
    options?: Options
): Promise<State> {
    const wrappers: Wrapper[] = [];
    const logStreams: Writable[] = [];

    const {
        childProcess = defaults.childProcess,
        gc = defaults.gc,
        retentionInDays = defaults.retentionInDays,
        memorySize = defaults.memorySize,
        timeout = defaults.timeout
    } = options || {};

    let gcPromise;
    if (gc) {
        gcPromise = collectGarbage(retentionInDays!);
    }
    const tempDir = join(tmpdir(), "cloudify", nonce);
    info(`tempDir: ${tempDir}`);
    await mkdir(tempDir, { recursive: true });
    const logDir = join(tempDir, "logs");
    await mkdir(logDir);
    const log = `file://${logDir}`;

    info(`logURL: ${log}`);

    const getWrapper = async () => {
        const idleWrapper = wrappers.find(w => w.executing === false);
        if (idleWrapper) {
            return idleWrapper;
        }
        let logStream: Writable;
        let childlog = (msg: string) => {
            logStream.write(msg);
            logStream.write("\n");
        };
        try {
            const logFile = join(logDir, `${wrappers.length}.log`);
            info(`Creating write stream ${logFile}`);
            logStream = createWriteStream(logFile);
            logStreams.push(logStream);
            await new Promise(resolve => logStream.on("open", resolve));
        } catch (err) {
            warn(`ERROR: Could not create log`);
            warn(err);
            childlog = console.log;
        }
        const wrapper = new Wrapper(require(serverModule), {
            log: childlog,
            useChildProcess: childProcess,
            childProcessMemoryLimitMb: memorySize,
            childProcessTimeout: timeout,
            childDir: tempDir
        });
        wrappers.push(wrapper);
        return wrapper;
    };

    const packerResult = await pack(serverModule, options);

    await unzipInDir(tempDir, packerResult.archive);
    const packageJsonFile = join(tempDir, "package.json");
    if (await exists(packageJsonFile)) {
        info(`Running 'npm install'`);
        await exec("npm install").then(x => {
            info(x.stdout);
            if (x.stderr) {
                warn(x.stderr);
            }
        });
    }

    return {
        wrappers,
        getWrapper,
        logStreams,
        tempDir,
        logUrl: log,
        gcPromise
    };
}

export function logUrl(state: State) {
    return state.logUrl;
}

async function pack(functionModule: string, options?: Options): Promise<PackerResult> {
    const popts: PackerOptions = options || {};
    return packer(localTrampolineFactory, functionModule, popts);
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
    const wrapper = await state.getWrapper();
    returned = await wrapper.execute({ call: scall, startTime });

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
    if (tempDir && tempDir.match(/\/cloudify\/[0-9a-f-]+$/) && (await exists(tempDir))) {
        info(`Deleting temp dir ${tempDir}`);
        await rmrf(tempDir);
    }
}

async function stop(state: State) {
    info(`Stopping`);
    await Promise.all(state.wrappers.map(wrapper => wrapper.stop()));
    await Promise.all(
        state.logStreams.map(stream => new Promise(resolve => stream.end(resolve)))
    );
    state.logStreams = [];
    state.wrappers = [];
    if (state.gcPromise) {
        await state.gcPromise;
    }
    info(`Stopping done`);
}

let garbageCollectorRunning = false;

async function collectGarbage(retentionInDays: number) {
    if (garbageCollectorRunning) {
        return;
    }
    garbageCollectorRunning = true;
    const tmp = join(tmpdir(), "cloudify");
    logGc(tmp);
    try {
        const dir = await readdir(tmp);
        for (const entry of dir) {
            if (entry.match(/^[a-f0-9-]+$/)) {
                const cloudifyDir = join(tmp, entry);
                try {
                    const stats = await stat(cloudifyDir);
                    if (hasExpired(stats.atimeMs, retentionInDays)) {
                        logGc(cloudifyDir);
                        await rmrf(cloudifyDir);
                    }
                } catch (err) {}
            }
        }
    } catch (err) {
        logGc(err);
    } finally {
        garbageCollectorRunning = false;
    }
}
