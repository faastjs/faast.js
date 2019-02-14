import * as sys from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { Writable } from "stream";
import { promisify } from "util";
import { createWriteStream, exists, mkdir, readdir, rmrf, stat } from "../fs";
import { info, logGc, warn } from "../log";
import { packer, PackerResult, unzipInDir } from "../packer";
import {
    CleanupOptions,
    CloudFunctionImpl,
    CommonOptionDefaults,
    CommonOptions,
    Invocation,
    PackerOptionDefaults,
    PollResult,
    ReceivableMessage,
    ResponseMessage,
    SendableMessage,
    UUID
} from "../provider";
import { hasExpired, uuidv4Pattern } from "../shared";
import { AsyncQueue } from "../throttle";
import { FunctionCall, Wrapper } from "../wrapper";
import * as localTrampolineFactory from "./local-trampoline";

const exec = promisify(sys.exec);

export interface State {
    wrappers: Wrapper[];
    getWrapper: () => Promise<Wrapper>;
    logStreams: Writable[];
    tempDir: string;
    logUrl: string;
    gcPromise?: Promise<void>;
    queue: AsyncQueue<ReceivableMessage>;
}

export interface Options extends CommonOptions {
    gcWorker?: (tempdir: string) => Promise<void>;
}

function defaultGcWorker(dir: string) {
    return rmrf(dir);
}

export const defaults: Required<Options> = {
    ...CommonOptionDefaults,
    concurrency: 10,
    memorySize: 512,
    timeout: 300,
    gcWorker: defaultGcWorker
};

export const Impl: CloudFunctionImpl<Options, State> = {
    name: "local",
    initialize,
    pack,
    defaults,
    cleanup,
    logUrl,
    invoke,
    poll,
    publish,
    responseQueueId
};

async function initialize(
    serverModule: string,
    nonce: UUID,
    options: Required<Options>
): Promise<State> {
    const wrappers: Wrapper[] = [];
    const logStreams: Writable[] = [];
    const { gc, retentionInDays, gcWorker } = options;

    let gcPromise;
    if (gc) {
        gcPromise = collectGarbage(gcWorker, retentionInDays!);
    }
    const tempDir = join(tmpdir(), "faast", nonce);
    info(`tempDir: ${tempDir}`);
    await mkdir(tempDir, { recursive: true });
    const logDir = join(tempDir, "logs");
    await mkdir(logDir);
    const log = `file://${logDir}`;

    info(`logURL: ${log}`);

    const { childProcess, memorySize, timeout } = options;

    const getWrapper = async () => {
        const idleWrapper = wrappers.find(w => w.executing === false);
        if (idleWrapper) {
            return idleWrapper;
        }
        let logStream: Writable;
        let childlog = (msg: string) => {
            if (logStream.writable) {
                logStream.write(msg);
                logStream.write("\n");
            }
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
            wrapperLog: childlog,
            childProcess: childProcess,
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
        gcPromise,
        queue: new AsyncQueue()
    };
}

export function logUrl(state: State) {
    return state.logUrl;
}

async function pack(
    functionModule: string,
    userOptions?: Options
): Promise<PackerResult> {
    const options = Object.assign({}, PackerOptionDefaults, userOptions);
    return packer(localTrampolineFactory, functionModule, options);
}

async function invoke(
    state: State,
    request: Invocation,
    cancel: Promise<void>
): Promise<ResponseMessage | void> {
    const {} = state;
    const startTime = Date.now();
    const wrapper = await state.getWrapper();
    const call: FunctionCall = JSON.parse(request.body);
    const promise = wrapper.execute({ call, startTime }, metrics =>
        state.queue.enqueue({
            kind: "cpumetrics",
            metrics,
            callId: call.callId,
            elapsed: Date.now() - startTime
        })
    );
    const returned = await Promise.race([promise, cancel]);
    if (!returned) {
        wrapper.stop();
        return;
    }
    return {
        kind: "response",
        body: returned,
        callId: request.callId,
        rawResponse: undefined,
        timestamp: Date.now()
    };
}

async function publish(state: State, message: SendableMessage): Promise<void> {
    state.queue.enqueue(message);
}

async function poll(state: State, cancel: Promise<void>): Promise<PollResult> {
    let message = await Promise.race([state.queue.dequeue(), cancel]);
    if (!message) {
        return { Messages: [] };
    }
    return { Messages: [message] };
}

function responseQueueId(_state: State): string | void {}

async function cleanup(state: State, options: CleanupOptions): Promise<void> {
    info(`local cleanup starting.`);

    await Promise.all(state.wrappers.map(wrapper => wrapper.stop()));
    await Promise.all(
        state.logStreams.map(stream => new Promise(resolve => stream.end(resolve)))
    );
    state.logStreams = [];
    state.wrappers = [];
    if (state.gcPromise) {
        await state.gcPromise;
    }

    if (options.deleteResources) {
        const { tempDir } = state;
        const pattern = new RegExp(`/faast/${uuidv4Pattern}$`);
        if (tempDir && tempDir.match(pattern) && (await exists(tempDir))) {
            info(`Deleting temp dir ${tempDir}`);
            await rmrf(tempDir);
        }
    }
    info(`local cleanup done.`);
}

let garbageCollectorRunning = false;

async function collectGarbage(
    gcWorker: (dir: string) => Promise<void>,
    retentionInDays: number
) {
    if (gcWorker === defaultGcWorker) {
        if (garbageCollectorRunning) {
            return;
        }
        garbageCollectorRunning = true;
    }
    const tmp = join(tmpdir(), "faast");
    logGc(tmp);
    try {
        const dir = await readdir(tmp);
        const pattern = new RegExp(`^${uuidv4Pattern}$`);
        for (const entry of dir) {
            if (entry.match(pattern)) {
                const faastDir = join(tmp, entry);
                try {
                    const stats = await stat(faastDir);
                    if (hasExpired(stats.atimeMs, retentionInDays)) {
                        logGc(faastDir);
                        await gcWorker(faastDir);
                    }
                } catch (err) {}
            }
        }
    } catch (err) {
        logGc(err);
    } finally {
        if (gcWorker === defaultGcWorker) {
            garbageCollectorRunning = false;
        }
    }
}
