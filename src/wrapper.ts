import childProcess from "child_process";
import process from "process";
import proctor from "process-doctor";
import { inspect } from "util";
import { IteratorResponseMessage, Message, PromiseResponseMessage } from "./provider";
import { deserialize, serializeReturnValue } from "./serialize";
import { AsyncIterableQueue } from "./throttle";
import { AnyFunction } from "./types";
import { FaastError, FaastErrorNames } from "./error";

const p = (val: any) => inspect(val, { compact: true, breakLength: Infinity });

export const isGenerator = (fn: Function) =>
    fn instanceof function* () {}.constructor ||
    fn instanceof async function* () {}.constructor;

export const filename = module.filename;

export interface CallId {
    callId: string;
}

export interface Trampoline {
    trampoline: AnyFunction;
}

export interface TrampolineFactory {
    filename: string;
    makeTrampoline: (wrapper: Wrapper) => Trampoline;
}

export interface FunctionCall extends CallId {
    args: string;
    modulePath: string;
    name: string;
    ResponseQueueId: string;
}

export interface CallingContext {
    call: FunctionCall;
    startTime: number;
    logUrl?: string;
    executionId?: string;
    instanceId?: string;
}

export interface ModuleType {
    [name: string]: any;
}

export function createErrorResponse(
    err: any,
    { call, startTime, logUrl, executionId }: CallingContext
): PromiseResponseMessage {
    return {
        kind: "promise",
        type: "reject",
        value: serializeReturnValue(call.name, err, false),
        isErrorObject: typeof err === "object" && err instanceof Error,
        callId: call.callId,
        remoteExecutionStartTime: startTime,
        remoteExecutionEndTime: Date.now(),
        logUrl,
        executionId
    };
}

export interface WrapperOptions {
    /**
     * Logging function for console.log/warn/error output. Only available in
     * child process mode. This is mainly useful for debugging the "local"
     * mode which runs code locally. In real clouds the logs will end up in the
     * cloud logging service (e.g. Cloudwatch Logs).
     * Defaults to console.log.
     */
    wrapperLog?: (msg: string) => void;
    childProcess?: boolean;
    childProcessMemoryLimitMb?: number;
    childProcessTimeoutMs?: number;
    childProcessEnvironment?: { [key: string]: string };
    childDir?: string;
    wrapperVerbose?: boolean;
    validateSerialization?: boolean;
}

export const WrapperOptionDefaults: Required<WrapperOptions> = {
    wrapperLog: console.log,
    childProcess: true,
    childProcessMemoryLimitMb: 0,
    childProcessTimeoutMs: 0,
    childProcessEnvironment: {},
    childDir: ".",
    wrapperVerbose: false,
    validateSerialization: true
};

type ErrorCallback = (err: Error) => Error;
type MessageCallback = (msg: Message) => Promise<void>;

export interface WrapperExecuteOptions {
    errorCallback?: ErrorCallback;
    onMessage: MessageCallback;
    measureCpuUsage?: boolean;
}

const oomPattern = /Allocation failed - JavaScript heap out of memory/;

const FAAST_CHILD_ENV = "FAAST_CHILD";

export class Wrapper {
    executing = false;
    selected = false;
    protected verbose = false;
    protected funcs: ModuleType = {};
    protected child?: childProcess.ChildProcess;
    protected childPid?: number;
    protected log: (msg: string) => void;
    protected queue: AsyncIterableQueue<Message>;
    readonly options: Required<WrapperOptions>;
    protected monitoringTimer?: NodeJS.Timeout;

    constructor(fModule: ModuleType, options: WrapperOptions = {}) {
        this.options = { ...WrapperOptionDefaults, ...options };
        this.log = this.options.wrapperLog;
        this.verbose = this.options.wrapperVerbose;
        this.funcs = fModule;
        this.queue = new AsyncIterableQueue();

        /* c8 ignore start */
        if (process.env[FAAST_CHILD_ENV]) {
            this.options.childProcess = false;
            this.log(`faast: started child process for module wrapper.`);
            process.on("message", async (cc: CallingContext) => {
                const startTime = Date.now();
                try {
                    await this.execute(
                        { ...cc, startTime },
                        {
                            onMessage: async msg => {
                                this.log(`Received message ${msg.kind}`);
                                process.send!({ done: false, value: msg });
                            }
                        }
                    );
                    this.log(`Done with this.execute()`);
                } catch (err: any) {
                    this.log(err);
                } finally {
                    process.send!({ done: true });
                }
            });
        } else {
            if (!process.env.FAAST_SILENT) {
                this.log(`faast: successful cold start.`);
            }
        }
        /* c8 ignore stop */
    }

    protected lookupFunction(request: object): AnyFunction {
        const { name, args } = request as FunctionCall;
        if (!name) {
            throw new Error("Invalid function call request: no name");
        }

        const func = this.funcs[name];
        if (!func) {
            throw new Error(`Function named "${name}" not found`);
        }

        if (!args) {
            throw new Error("Invalid arguments to function call");
        }
        return func;
    }

    protected stopCpuMonitoring() {
        this.monitoringTimer && clearInterval(this.monitoringTimer);
        this.monitoringTimer = undefined;
    }

    protected startCpuMonitoring(pid: number, callId: string) {
        if (this.monitoringTimer) {
            this.stopCpuMonitoring();
        }
        this.monitoringTimer = cpuMonitor(pid, 1000, (err, result) => {
            if (err) {
                this.log(`cpu monitor error: ${err}`);
            }
            if (result) {
                this.queue.push({ kind: "cpumetrics", callId, metrics: result });
            }
        });
    }

    stop() {
        this.stopCpuMonitoring();
        if (this.child) {
            this.log(`Stopping child process.`);
            this.child.stdout!.removeListener("data", this.logLines);
            this.child.stderr!.removeListener("data", this.logLines);
            this.child!.disconnect();
            this.child!.kill();
            this.child = undefined;
            this.executing = false;
        }
    }

    async execute(
        callingContext: CallingContext,
        { errorCallback, onMessage, measureCpuUsage }: WrapperExecuteOptions
    ): Promise<void> {
        const processError = (err: any) =>
            err instanceof Error && errorCallback ? errorCallback(err) : err;
        try {
            /* c8 ignore start  */
            if (this.executing) {
                this.log(`faast: warning: module wrapper execute is not re-entrant`);
                throw new Error(`faast: module wrapper is not re-entrant`);
            }
            /* c8 ignore stop  */
            this.executing = true;
            const { call, startTime, logUrl, executionId, instanceId } = callingContext;
            const detail = { logUrl, executionId, instanceId };
            const { callId } = call;
            this.log(`calling: ${call.name}`);
            this.log(`   args: ${call.args}`);
            this.log(`   callId: ${callId}`);
            // let startedMessageTimer: NodeJS.Timeout | undefined = setTimeout(
            //     () => messageCallback({ kind: "functionstarted", callId }),
            //     2 * 1000
            // );

            // TODO: Add this code after the execute returns or yields its first value...
            // if (startedMessageTimer) {
            //     clearTimeout(startedMessageTimer);
            //     startedMessageTimer = undefined;
            // }

            const memoryUsage = process.memoryUsage();
            const memInfo = p(memoryUsage);
            if (this.options.childProcess) {
                if (!this.child) {
                    this.child = this.setupChildProcess();
                }
                this.verbose &&
                    this.log(
                        `faast: invoking '${call.name}' in child process, memory: ${memInfo}`
                    );
                this.child.send(callingContext, err => {
                    /* c8 ignore start */
                    if (err) {
                        this.log(`child send error: rejecting with ${err}`);
                        this.queue.push(Promise.reject(err));
                    }
                    /* c8 ignore stop */
                });
                if (measureCpuUsage) {
                    this.verbose &&
                        this.log(`Starting CPU monitor for pid ${this.child.pid}`);
                    // XXX CPU Monitoring not enabled for now.
                    // this.startCpuMonitoring(this.child.pid, callId);
                }

                let timer;
                const timeout = this.options.childProcessTimeoutMs;
                if (timeout) {
                    this.verbose && this.log(`Setting timeout: ${timeout}`);
                    timer = setTimeout(() => {
                        const error = new FaastError(
                            {
                                name: FaastErrorNames.ETIMEOUT,
                                info: { ...detail, functionName: call.name }
                            },
                            `Request exceeded timeout of ${timeout}ms`
                        );

                        this.queue.push(Promise.reject(error));
                        this.stop();
                    }, timeout);
                }
                this.verbose && this.log(`awaiting async dequeue`);
                try {
                    const promises = [];
                    for await (const result of this.queue) {
                        this.verbose && this.log(`Dequeuing ${p(result)}`);
                        if (result.kind === "promise" || result.kind === "iterator") {
                            result.logUrl = logUrl;
                        }
                        promises.push(onMessage(result));
                    }
                    await Promise.all(promises);
                } finally {
                    this.verbose && this.log(`Finalizing queue`);
                    this.stopCpuMonitoring();
                    timer && clearTimeout(timer);
                    this.queue.clear();
                }
            } else {
                this.verbose &&
                    this.log(`faast: Invoking '${call.name}', memory: ${memInfo}`);
                const func = this.lookupFunction(call);
                if (!func) {
                    throw new Error(
                        `faast module wrapper: could not find function '${call.name}'`
                    );
                }
                const args = deserialize(call.args);
                let value;
                try {
                    value = await func.apply(undefined, args);
                    this.verbose && this.log(`Finished call function`);
                } catch (err: any) {
                    this.log(`Function ${call.name} threw error: ${err}`);
                    throw err;
                }
                this.verbose &&
                    this.log(`returned value: ${p(value)}, type: ${typeof value}`);

                const validate = this.options.validateSerialization;
                const context = { type: "fulfill", callId, ...detail } as const;
                // Check for iterable.

                if (value !== null && value !== undefined) {
                    if (isGenerator(func)) {
                        let next = await value.next();
                        let sequence = 0;
                        while (true) {
                            this.verbose && this.log(`next: ${p(next)}`);
                            let result: IteratorResponseMessage = {
                                ...context,
                                kind: "iterator",
                                value: serializeReturnValue(call.name, [next], validate),
                                sequence
                            } as const;
                            if (next.done) {
                                result.remoteExecutionStartTime = startTime;
                                result.remoteExecutionEndTime = Date.now();
                                result.memoryUsage = memoryUsage;
                            }
                            await onMessage(result);
                            if (next.done) {
                                return;
                            }
                            sequence++;
                            next = await value.next();
                        }
                    }
                }

                await onMessage({
                    ...context,
                    kind: "promise",
                    value: serializeReturnValue(call.name, [value], validate),
                    remoteExecutionStartTime: startTime,
                    remoteExecutionEndTime: Date.now(),
                    memoryUsage
                });
            }
        } catch (err: any) {
            this.log(`faast: wrapped function exception or promise rejection: ${err}`);
            const response = createErrorResponse(processError(err), callingContext);
            this.log(`Error response: ${inspect(response)}`);
            await onMessage(response);
        } finally {
            this.verbose && this.log(`Exiting execute`);
            this.executing = false;
        }
    }

    protected logLines = (msg: string) => {
        let lines = msg.split("\n");
        if (lines[lines.length - 1] === "") {
            lines = lines.slice(0, lines.length - 1);
        }
        for (const line of lines) {
            this.log(`[${this.childPid}]: ${line}`);
        }
    };

    protected setupChildProcess() {
        this.verbose && this.log(`faast: creating child process`);

        let execArgv = process.execArgv.slice();
        if (this.options.childProcessMemoryLimitMb) {
            /* c8 ignore next */
            execArgv = process.execArgv.filter(
                arg => !arg.match(/^--max-old-space-size/) && !arg.match(/^--inspect/)
            );
            execArgv.push(
                `--max-old-space-size=${this.options.childProcessMemoryLimitMb}`
            );
        }

        const { childProcessEnvironment } = this.options;
        const env = {
            ...process.env,
            ...childProcessEnvironment,
            [FAAST_CHILD_ENV]: "true"
        };
        this.verbose && this.log(`Env: ${JSON.stringify(env)}`);
        const forkOptions: childProcess.ForkOptions = {
            silent: true, // redirects stdout and stderr to IPC.
            env,
            cwd: this.options.childDir,
            execArgv
        };

        const child = childProcess.fork("./index.js", [], forkOptions);
        this.childPid = child.pid;

        child.stdout!.setEncoding("utf8");
        child.stderr!.setEncoding("utf8");

        let oom: string | undefined;
        const detectOom = (chunk: string) => {
            if (oomPattern.test(chunk)) {
                oom = chunk;
            }
        };
        child.stdout!.on("data", this.logLines);
        child.stderr!.on("data", this.logLines);
        child.stderr!.on("data", detectOom);
        child.on("message", (message: IteratorResult<Message>) => {
            this.verbose && this.log(`child message: resolving with ${p(message)}`);
            if (message.done) {
                this.queue.done();
            } else {
                this.queue.push(message.value);
            }
        });
        /* c8 ignore next  */
        child.on("error", err => {
            this.verbose && this.log(`child error: rejecting with ${err}`);
            this.child = undefined;
            this.queue.push(Promise.reject(err));
        });
        child.on("exit", (code, signal) => {
            this.verbose && this.log(`child exit: code: ${code}, signal: ${signal}`);
            this.child = undefined;
            if (code) {
                this.queue.push(
                    Promise.reject(new Error(`Exited with error code ${code}`))
                );
            } else if (signal !== null && signal !== "SIGTERM") {
                let errorMessage = `Aborted with signal ${signal}`;
                if (signal === "SIGABRT" && oom) {
                    errorMessage += ` (${oom})`;
                    oom = undefined;
                }
                this.queue.push(Promise.reject(new Error(errorMessage)));
            } else {
                this.verbose && this.log(`child exiting normally`);
            }
        });
        return child;
    }
}

export interface CpuMeasurement {
    stime: number;
    utime: number;
    elapsed: number;
}

function cpuMonitor(
    pid: number,
    interval: number,
    callback: (err?: Error, result?: CpuMeasurement) => void
) {
    const start = Date.now();
    const timer = setInterval(
        () =>
            proctor.lookup(pid, (err, result) => {
                if (err) {
                    callback(err);
                    return;
                }
                const { stime, utime } = result;
                callback(
                    err,
                    result && {
                        stime: stime * 10,
                        utime: utime * 10,
                        elapsed: Date.now() - start
                    }
                );
            }),
        interval
    );
    return timer;
}
