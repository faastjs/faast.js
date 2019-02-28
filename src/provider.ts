import * as webpack from "webpack";
import { CostBreakdown } from "./cost";
import { Statistics } from "./shared";
import { CpuMeasurement, FunctionReturn } from "./wrapper";

export const CALLID_ATTR = "__faast_callid__";
export const KIND_ATTR = "__faast_kind__";

/**
 * Options common across all faast.js providers.
 * @public
 */
export interface CommonOptions {
    /**
     * Add local directories to the code package.
     * @remarks
     * Each directory is recursively traversed. On the remote side, the
     * directories will be available on the file system relative to the current
     * working directory.
     */
    addDirectory?: string | string[];
    /**
     * Add zip files to the code package.
     * @remarks
     * Each file is unzipped on the remote side under the current working
     * directory.
     */
    addZipFile?: string | string[];
    /**
     * If true, create a child process to isolate user code from faast
     * scaffolding. Default: true.
     * @remarks
     * If a child process is not created, faast runs in the same node instance
     * as the user code and may not execute in a timely fashion because user
     * code may
     * {@link https://nodejs.org/en/docs/guides/dont-block-the-event-loop/ | block the event loop}.
     * Creating a child process for user code allows faast.js to continue
     * executing even if user code never yields. This provides better
     * reliability and functionality:
     *
     * - Detect timeout errors immediately instead of waiting for the provider's
     *   dead letter queue messages, which may take several minutes.
     *
     *  - CPU metrics used for detecting invocations with high latency, which
     *    can be used for automatically retrying calls to reduce tail latency.
     *
     * The cost of creating a child process is mainly in the memory overhead of
     * creating another node process, which may consume a baseline of XXX.
     */
    childProcess?: boolean;
    /**
     * The maximum number of concurrent invocations to allow. Default: 100,
     * except for the `local` provider, where the default is 10.
     * @remarks
     * The concurrency limit applies to all invocations of all of the faast
     * functions summed together. It is not a per-function limit. To apply a
     * per-function limit, use {@link throttle}. A value of 0 is equivalent to
     * Infinity. A value of 1 ensures mutually exclusive invocations.
     */
    concurrency?: number;
    /**
     * Garbage collection is enabled if true. Default: true.
     * @remarks
     * Garbage collection deletes resources that were created by previous
     * instantiations of faast that were not cleaned up by
     * {@link CloudFunction.cleanup}, either because it was not called or
     * because the process terminated and did not execute this cleanup step.
     *
     * Garbage collection is cloud-specific, but in general garbage collection
     * should not interfere with the behavior or performance of faast functions.
     * When {@link CloudFunction.cleanup} runs, it waits for garbage collection
     * to complete. Therefore the cleanup step can in some circumstances take a
     * significant amount of time even after all invocations have returned.
     *
     * It is generally recommended to leave garbage collection on, otherwise
     * garbage resources may accumulate over time and you will eventually hit
     * resource limits on your account.
     *
     * One use case for turning off garbage collection is when many invocations
     * of faast are occurring in separate processes. In this case it can make
     * sense to leave gc on in only one process. Note that if faast is invoked
     * multiple times within one process, faast will automatically only run gc
     * once every hour.
     *
     * Also see {@link CommonOptions.retentionInDays}.
     */
    gc?: boolean;
    /**
     * Maximum number of times that faast will retry each invocation. Default: 2
     * (invocations can therefore be attemped 3 times in total).
     * @remarks
     * Retries are automatically attempted for transient infrastructure-level
     * failures such as rate limits or netowrk failures. User-level exceptions
     * are not retried automatically. In addition to retries performed by faast,
     * some providers automatically attempt retries. These are not controllable
     * by faast. But as a result, your function may be retried many more times
     * than this setting suggests.
     */
    maxRetries?: number;
    /**
     * Memory limit for each function in MB. This setting has an effect on
     * pricing. Default varies by provider.
     * @remarks
     * Each provider has different settings for memory size, and performance
     * varies depending on the setting. By default faast picks a likely optimal
     * value for each provider.
     *
     * - **aws**: 1728MB
     *
     * - **google**: 1024MB
     *
     * - **local**: 512MB
     */
    memorySize?: number;
    /**
     * Specify invocation mode, one of `"auto"`, `"https"`, or `"queue"`.
     * Default: `"auto"`.
     * @remarks
     * Modes specify how invocations are triggered. In https mode, the functions
     * are invoked through an https request or the provider's API. In queue
     * mode, a provider-specific queue is used to invoke functions. Queue mode
     * adds additional latency and (usually negligible) cost, but may scale
     * better for some providers. In auto mode the best default is chosen for
     * each provider depending on its particular performance characteristics.
     *
     * The defaults are:
     *
     * - **aws**: `"auto"` is the same as `"queue"`. In https mode, the AWS SDK
     *   api is used to invoke functions. In queue mode, an AWS SNS topic is
     *   created and triggers invocations. The AWS API Gateway service is never
     *   used by faast, as it incurs a higher cost and is not needed to trigger
     *   invocations.
     *
     * - **google**: `"auto"` is `"https"`. In https mode, a PUT request is made
     *   to invoke the cloud function. In queue mode, a PubSub topic is created
     *   to invoke functions.
     *
     * - **local**: The local provider ignores the mode setting and always uses
     *   an internal asynchronous queue to schedule calls.
     *
     * Note that no matter which mode is selected, faast.js always uses queue to
     * send results back. This queue is required because there are intermediate
     * data that faast.js needs for bookeeping and performance monitoring.
     */
    mode?: "https" | "queue" | "auto";
    /**
     * Specify a package.json file to include with the code package.
     * @remarks
     * By default, faast.js will use webpack to bundle dependencies your remote
     * module imports. In normal usage there is no need to specify a separate
     * package.json, as webpack will statically analyze your imports and
     * determine which files to bundle.
     *
     * However, there are some use cases where this is not enough. For example,
     * some dependencies contain native code compiled during installation, and
     * webpack cannot bundle these native modules. such as dependencies with
     * native code.  or are specifically not designed to work with webpack. In
     * these cases, you can create a separate `package.json` for these
     * dependencies and pass the filename as the `packageJson` option.
     *
     * The way the `packageJson` is handled varies by provider:
     *
     * - **local**: Runs `npm install` in a temporary directory it prepares for the
     *   function.
     *
     * - **google**: uses Google Cloud Function's
     *   {@link https://cloud.google.com/functions/docs/writing/specifying-dependencies-nodejs | native support for package.json}.
     *
     * - **aws**: Recursively calls faast.js to run `npm install` inside a separate
     *   lambda function specifically created for this purpose. Faast.js uses
     *   lambda to install dependencies to ensure that native dependencies are
     *   compiled in an environment that can produce binaries linked against
     *   lambda's
     *   {@link https://aws.amazon.com/blogs/compute/running-executables-in-aws-lambda/ | execution environment}.
     *
     * Also see {@link CommonOptions.useDependencyCaching}.
     */
    packageJson?: string | object | false;
    /**
     * Cache installed dependencies from {@link packageJson}. Only applies to
     * AWS. Default: true.
     * @remarks
     * The resulting `node_modules` folder is cached both locally and also on S3
     * under the bucket `faast-cache-*-${region}`. These cache entries expire by
     * default after 24h. Using caching reduces the need to install and upload
     * dependencies every time a function is created. This is important for AWS
     * because it creates an entirely separate lambda function to install
     * dependencies remotely, which can substantially increase function
     * deployment time.
     */
    useDependencyCaching?: boolean;
    /**
     * Specify how many days to wait before reclaiming cloud garbage. Default: 1.
     * @remarks
     * Garbage collection only deletes resources after they age beyond a certain number of days.
     * See {@link CommonOptions.gc}.
     */
    retentionInDays?: number;
    speculativeRetryThreshold?: number;
    timeout?: number;
    webpackOptions?: webpack.Configuration;
}

export const CommonOptionDefaults: Required<CommonOptions> = {
    addDirectory: [],
    addZipFile: [],
    childProcess: true,
    concurrency: 100,
    gc: true,
    maxRetries: 2,
    memorySize: 1024,
    mode: "auto",
    packageJson: false,
    useDependencyCaching: true,
    retentionInDays: 1,
    speculativeRetryThreshold: 3,
    timeout: 60,
    webpackOptions: {}
};

/**
 * @public
 */
export interface CleanupOptions {
    deleteResources?: boolean;
}

export const CleanupOptionDefaults: Required<CleanupOptions> = {
    deleteResources: true
};

/**
 * @public
 */
export class FunctionCounters {
    invocations = 0;
    completed = 0;
    retries = 0;
    errors = 0;

    toString() {
        return `completed: ${this.completed}, retries: ${this.retries}, errors: ${
            this.errors
        }`;
    }
}

/**
 * @public
 */
export class FunctionStats {
    localStartLatency = new Statistics();
    remoteStartLatency = new Statistics();
    executionTime = new Statistics();
    sendResponseLatency = new Statistics();
    returnLatency = new Statistics();
    estimatedBilledTime = new Statistics();

    toString() {
        return Object.keys(this)
            .map(key => `${key}: ${(<any>this)[key]}`)
            .join(", ");
    }
}

export class FunctionExecutionMetrics {
    secondMetrics: Statistics[] = [];
}

export type StringifiedFunctionCall = string;
export type StringifiedFunctionReturn = string;

export type CallId = string;

export interface Invocation {
    callId: CallId;
    body: StringifiedFunctionCall;
}

export interface ResponseMessage {
    kind: "response";
    callId: CallId;
    body: StringifiedFunctionReturn | FunctionReturn;
    rawResponse?: any;
    timestamp?: number; // timestamp when response message was sent according to cloud service, this is optional and used to provide more accurate metrics.
}

export interface DeadLetterMessage {
    kind: "deadletter";
    callId: CallId;
    message?: string;
}

export interface StopQueueMessage {
    kind: "stopqueue";
}

export interface FunctionStartedMessage {
    kind: "functionstarted";
    callId: CallId;
}

export interface CpuMetricsMessage {
    kind: "cpumetrics";
    callId: CallId;
    metrics: CpuMeasurement;
}

export interface PollResult {
    Messages: ReceivableMessage[];
    isFullMessageBatch?: boolean;
}

export type SendableMessage = StopQueueMessage;

export type ReceivableMessage =
    | DeadLetterMessage
    | ResponseMessage
    | FunctionStartedMessage
    | StopQueueMessage
    | CpuMetricsMessage;

export type Message = SendableMessage | ReceivableMessage;
export type SendableKind = SendableMessage["kind"];
export type ReceivableKind = ReceivableMessage["kind"];
export type Kind = Message["kind"];
export type UUID = string;

export interface CloudFunctionImpl<O extends CommonOptions, S> {
    name: string;
    defaults: Required<O>;

    initialize(serverModule: string, nonce: UUID, options: Required<O>): Promise<S>;

    costEstimate?: (
        state: S,
        counters: FunctionCounters,
        stats: FunctionStats
    ) => Promise<CostBreakdown>;

    cleanup(state: S, options: Required<CleanupOptions>): Promise<void>;
    logUrl(state: S): string;
    invoke(
        state: S,
        request: Invocation,
        cancel: Promise<void>
    ): Promise<ResponseMessage | void>;
    publish(state: S, message: SendableMessage): Promise<void>;
    poll(state: S, cancel: Promise<void>): Promise<PollResult>;
    responseQueueId(state: S): string | void;
}
