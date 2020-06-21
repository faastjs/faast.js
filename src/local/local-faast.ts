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
    Message,
    PollResult,
    ProviderImpl,
    UUID
} from "../provider";
import { hasExpired, uuidv4Pattern } from "../shared";
import { AsyncQueue } from "../throttle";
import { FunctionCall, Wrapper, WrapperOptions } from "../wrapper";
import * as localTrampolineFactory from "./local-trampoline";

const exec = promisify(sys.exec);

interface Executor {
    wrapper: Wrapper;
    logUrl: string;
    logStream?: Writable;
}

/**
 * @public
 */
export interface LocalState {
    /** @internal */
    executors: Executor[];
    /** @internal */
    getExecutor: () => Executor;
    /** The temporary directory where the local function is deployed. */
    tempDir: string;
    /** The file:// URL for the local function log file directory.  */
    logUrl: string;
    /** @internal */
    gcPromise?: Promise<void>;
    /** @internal */
    queue: AsyncQueue<Message>;
    /** Options used to initialize the local function. */
    options: Required<LocalOptions>;
}

/**
 * Local provider options for {@link faastLocal}.
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
    const wrappers: Executor[] = [];
    const { gc, retentionInDays, _gcWorker: gcWorker } = options;

    let gcPromise;
    if (gc === "auto" || gc === "force") {
        gcPromise = collectGarbage(gcWorker, retentionInDays!);
    }
    const tempDir = join(tmpdir(), "faast", nonce);
    log.info(`tempDir: ${tempDir} [${options.description}]`);
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
    const getWrapperInfo = () => {
        const idleWrapper = wrappers.find(w => w.wrapper.executing === false);
        if (idleWrapper) {
            return idleWrapper;
        }
        let logStream!: Writable;
        let childlog = (msg: string) => {
            if (logStream.writable) {
                logStream.write(msg);
                logStream.write("\n");
            } else {
                log.provider(`WARNING: childlog not writable: ${msg}`);
            }
        };
        const logFile = join(logDir, `${wrappers.length}.log`);

        try {
            log.info(`Creating write stream ${logFile}`);
            logStream = createWriteStream(logFile);
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
        const rv = { wrapper, logUrl: `file://${logFile}`, logStream };
        wrappers.push(rv);
        return rv;
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
        executors: wrappers,
        getExecutor: getWrapperInfo,
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
    call: FunctionCall,
    _: Promise<void>
): Promise<void> {
    const {} = state;
    const startTime = Date.now();
    const { wrapper, logUrl: url } = state.getExecutor();
    await wrapper.execute(
        { call, startTime, logUrl: url },
        { onMessage: async msg => state.queue.enqueue(msg) }
    );
}

async function poll(state: LocalState, cancel: Promise<void>): Promise<PollResult> {
    const message = await Promise.race([state.queue.next(), cancel]);
    if (!message) {
        return { Messages: [] };
    }
    return { Messages: [message] };
}

function responseQueueId(_state: LocalState): string {
    return "<none>";
}

async function cleanup(state: LocalState, options: CleanupOptions): Promise<void> {
    log.info(`local cleanup starting.`);

    await Promise.all(state.executors.map(e => e.wrapper.stop()));
    await Promise.all(
        state.executors.map(e => new Promise(resolve => e.logStream?.end(resolve)))
    );
    state.executors = [];
    if (state.gcPromise) {
        await state.gcPromise;
    }

    if (options.deleteResources) {
        const { tempDir } = state;
        const pattern = new RegExp(`/faast/${uuidv4Pattern}$`);
        if (tempDir.match(pattern) && (await pathExists(tempDir))) {
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
