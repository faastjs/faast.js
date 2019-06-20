import * as sys from "child_process";
import {
    createWriteStream,
    mkdir,
    mkdirp,
    pathExists,
    readdir,
    remove,
    stat
} from "fs-extra";
import { tmpdir } from "os";
import { join } from "path";
import { Writable } from "stream";
import { promisify } from "util";
import { CostMetric, CostSnapshot } from "../cost";
import { log } from "../log";
import { packer, PackerResult, unzipInDir } from "../packer";
import {
    CleanupOptions,
    commonDefaults,
    CommonOptions,
    FunctionStats,
    PollResult,
    ProviderImpl,
    ReceivableMessage,
    ResponseMessage,
    UUID
} from "../provider";
import { hasExpired, uuidv4Pattern } from "../shared";
import { AsyncQueue } from "../throttle";
import { FunctionCallSerialized, Wrapper, WrapperOptions } from "../wrapper";
import * as localTrampolineFactory from "./local-trampoline";

const exec = promisify(sys.exec);

/**
 * @public
 */
export interface LocalState {
    /** @internal */
    wrappers: Wrapper[];
    /** @internal */
    getWrapper: () => Wrapper;
    /** @internal */
    logStreams: Writable[];
    /** The temporary directory where the local function is deployed. */
    tempDir: string;
    /** The file:// URL for the local function log file directory.  */
    logUrl: string;
    /** @internal */
    gcPromise?: Promise<void>;
    /** @internal */
    queue: AsyncQueue<ReceivableMessage>;
    /** Options used to initialize the local function. */
    options: Required<LocalOptions>;
}

/**
 * Local provider options for {@link faastLocal}. Extends {@link CommonOptions}.
 *
 * @public
 */
export interface LocalOptions extends CommonOptions {
    /** @internal */
    _gcWorker?: (tempdir: string) => Promise<void>;
}

export function defaultGcWorker(dir: string) {
    return remove(dir);
}

export const defaults: Required<LocalOptions> = {
    ...commonDefaults,
    concurrency: 10,
    memorySize: 512,
    _gcWorker: defaultGcWorker
};

export const LocalImpl: ProviderImpl<LocalOptions, LocalState> = {
    name: "local",
    initialize,
    defaults,
    cleanup,
    costSnapshot,
    logUrl,
    invoke,
    poll,
    responseQueueId
};

async function initialize(
    serverModule: string,
    nonce: UUID,
    options: Required<LocalOptions>
): Promise<LocalState> {
    const wrappers: Wrapper[] = [];
    const logStreams: Writable[] = [];
    const { gc, retentionInDays, _gcWorker: gcWorker } = options;

    let gcPromise;
    if (gc === "auto" || gc === "force") {
        gcPromise = collectGarbage(gcWorker, retentionInDays!);
    }
    const tempDir = join(tmpdir(), "faast", nonce);
    log.info(`tempDir: ${tempDir}`);
    await mkdirp(tempDir);
    const logDir = join(tempDir, "logs");
    await mkdir(logDir);
    const url = `file://${logDir}`;

    log.info(`logURL: ${url}`);

    const { childProcess, memorySize, timeout, env, validateSerialization } = options;

    if (!childProcess) {
        process.env = { ...process.env, ...env };
    }
    const { wrapperVerbose } = options.debugOptions;
    const getWrapper = () => {
        const idleWrapper = wrappers.find(w => w.executing === false);
        if (idleWrapper) {
            return idleWrapper;
        }
        let logStream: Writable;
        let childlog = (msg: string) => {
            if (logStream.writable) {
                logStream.write(msg);
                logStream.write("\n");
            } else {
                log.provider(`WARNING: childlog not writable: ${msg}`);
            }
        };
        try {
            const logFile = join(logDir, `${wrappers.length}.log`);
            log.info(`Creating write stream ${logFile}`);
            logStream = createWriteStream(logFile);
            logStreams.push(logStream);
        } catch (err) {
            log.warn(`ERROR: Could not create log`);
            log.warn(err);
            childlog = console.log;
        }
        const wrapperOptions2: Required<WrapperOptions> = {
            wrapperLog: childlog,
            childProcess,
            childProcessMemoryLimitMb: memorySize,
            childProcessTimeoutMs: timeout * 1000 - (childProcess ? 50 : 0),
            childProcessEnvironment: env,
            childDir: tempDir,
            wrapperVerbose: wrapperVerbose || log.provider.enabled,
            validateSerialization
        };
        const wrapper = new Wrapper(require(serverModule), wrapperOptions2);
        wrappers.push(wrapper);
        return wrapper;
    };

    const packerResult = await localPacker(
        serverModule,
        options,
        { wrapperVerbose },
        `faast-${nonce}`
    );

    await unzipInDir(tempDir, packerResult.archive);
    if (options.packageJson) {
        log.info(`Running 'npm install'`);

        await exec("npm install --no-package-lock", { cwd: tempDir }).then(x => {
            log.info(x.stdout);
            if (x.stderr) {
                log.warn(x.stderr);
            }
        });
    }

    return {
        wrappers,
        getWrapper,
        logStreams,
        tempDir,
        logUrl: url,
        gcPromise,
        queue: new AsyncQueue(),
        options
    };
}

export function logUrl(state: LocalState) {
    return state.logUrl;
}

export async function localPacker(
    functionModule: string,
    options: CommonOptions,
    wrapperOptions: WrapperOptions,
    FunctionName: string
): Promise<PackerResult> {
    return packer(
        localTrampolineFactory,
        functionModule,
        options,
        wrapperOptions,
        FunctionName
    );
}

async function invoke(
    state: LocalState,
    sCall: FunctionCallSerialized,
    cancel: Promise<void>
): Promise<ResponseMessage | void> {
    const {} = state;
    const startTime = Date.now();
    const wrapper = state.getWrapper();
    const promise = wrapper.execute(
        { sCall, startTime },
        {
            onCpuUsage: metrics =>
                state.queue.enqueue({
                    kind: "cpumetrics",
                    metrics,
                    callId: sCall.callId
                })
        }
    );
    const result = await Promise.race([promise, cancel]);
    if (!result) {
        wrapper.stop();
        return;
    }
    return {
        kind: "response",
        body: result,
        callId: sCall.callId,
        rawResponse: undefined,
        timestamp: Date.now()
    };
}

async function poll(state: LocalState, cancel: Promise<void>): Promise<PollResult> {
    const message = await Promise.race([state.queue.dequeue(), cancel]);
    if (!message) {
        return { Messages: [] };
    }
    return { Messages: [message] };
}

function responseQueueId(_state: LocalState): string | void {}

async function cleanup(state: LocalState, options: CleanupOptions): Promise<void> {
    log.info(`local cleanup starting.`);

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
        if (tempDir && tempDir.match(pattern) && (await pathExists(tempDir))) {
            log.info(`Deleting temp dir ${tempDir}`);
            await remove(tempDir);
        }
    }
    log.info(`local cleanup done.`);
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
    log.gc(tmp);
    try {
        const dir = await readdir(tmp);
        const pattern = new RegExp(`^${uuidv4Pattern}$`);
        for (const entry of dir) {
            if (entry.match(pattern)) {
                const faastDir = join(tmp, entry);
                try {
                    const stats = await stat(faastDir);
                    if (hasExpired(stats.atimeMs, retentionInDays)) {
                        log.gc(faastDir);
                        await gcWorker(faastDir);
                    }
                } catch (err) {}
            }
        }
    } catch (err) {
        log.gc(err);
    } finally {
        if (gcWorker === defaultGcWorker) {
            garbageCollectorRunning = false;
        }
    }
}

export async function costSnapshot(state: LocalState, stats: FunctionStats) {
    const billedTimeStats = stats.estimatedBilledTime;
    const seconds = (billedTimeStats.mean / 1000) * billedTimeStats.samples || 0;

    const costMetrics: CostMetric[] = [];
    const functionCallDuration = new CostMetric({
        name: "functionCallDuration",
        pricing: 0,
        unit: "second",
        measured: seconds,
        informationalOnly: true
    });
    costMetrics.push(functionCallDuration);

    const functionCallRequests = new CostMetric({
        name: "functionCallRequests",
        pricing: 0,
        measured: stats.invocations,
        unit: "request",
        informationalOnly: true
    });
    costMetrics.push(functionCallRequests);
    return new CostSnapshot("local", state.options, stats, costMetrics);
}
