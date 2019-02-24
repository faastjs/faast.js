// @public (undocumented)
declare const awsConfigurations: CostAnalyzerConfiguration[];

// @public (undocumented)
declare class AWSLambda<M extends object = object> extends CloudFunction<M, AwsOptions, AwsState> {
}

// @public (undocumented)
interface AwsOptions extends CommonOptions {
    // (undocumented)
    awsLambdaOptions?: Partial<aws.Lambda.Types.CreateFunctionRequest>;
    // (undocumented)
    CacheBucket?: string;
    // (undocumented)
    gcWorker?: (services: AWSServices, work: GcWork) => Promise<void>;
    // (undocumented)
    PolicyArn?: string;
    // (undocumented)
    region?: AWSRegion;
    // (undocumented)
    RoleName?: string;
    // (undocumented)
    useDependencyCaching?: boolean;
}

// @public (undocumented)
interface AwsState {
    // (undocumented)
    gcPromise?: Promise<void>;
    // (undocumented)
    metrics: AWSMetrics;
    // (undocumented)
    options: Required<AwsOptions>;
    // (undocumented)
    resources: AWSResources;
    // (undocumented)
    services: AWSServices;
}

// @public (undocumented)
interface CleanupOptions {
    // (undocumented)
    deleteResources?: boolean;
}

// @public (undocumented)
declare class CloudFunction<M extends object, O extends CommonOptions = CommonOptions, S = any> {
    // (undocumented)
    constructor(impl: CloudFunctionImpl<O, S>, state: S, fmodule: M, modulePath: string, options: Required<CommonOptions>);
    // (undocumented)
    protected adjustCollectorConcurrencyLevel(full?: boolean): void;
    // (undocumented)
    protected callResultsPending: Map<CallId, PendingRequest>;
    // (undocumented)
    cleanup(userCleanupOptions?: CleanupOptions): Promise<void>;
    // (undocumented)
    protected cleanupHooks: Set<Deferred>;
    // (undocumented)
    cloudName: string;
    // (undocumented)
    protected collectorPump: Pump<void>;
    // (undocumented)
    costEstimate(): Promise<CostBreakdown>;
    // (undocumented)
    counters: FunctionCountersMap;
    // (undocumented)
    protected cpuUsage: FactoryMap<string, FunctionCpuUsagePerSecond>;
    // (undocumented)
    protected emitter: EventEmitter;
    // (undocumented)
    protected fmodule: M;
    // (undocumented)
    functions: Promisified<M>;
    // (undocumented)
    protected funnel: Funnel<any>;
    // (undocumented)
    protected impl: CloudFunctionImpl<O, S>;
    // (undocumented)
    protected initialInvocationTime: FactoryMap<string, number>;
    // (undocumented)
    logUrl(): string;
    // (undocumented)
    protected memoryLeakDetector: MemoryLeakDetector;
    // (undocumented)
    protected modulePath: string;
    // (undocumented)
    off(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void): EventEmitter;
    // (undocumented)
    on(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void): EventEmitter;
    // (undocumented)
    readonly options: Required<CommonOptions>;
    // (undocumented)
    protected resultCollector(): Promise<void>;
    // (undocumented)
    protected skew: ExponentiallyDecayingAverageValue;
    // (undocumented)
    protected startStats(interval?: number): void;
    // (undocumented)
    readonly state: S;
    // (undocumented)
    stats: FunctionStatsMap;
    // (undocumented)
    protected statsTimer?: NodeJS.Timer;
    // (undocumented)
    protected stopStats(): void;
    // (undocumented)
    protected withCancellation<T>(fn: (cancel: Promise<void>) => Promise<T>): Promise<T>;
    // (undocumented)
    protected wrapFunction<A extends any[], R>(fn: (...args: A) => R): PromisifiedFunction<A, R>;
    // (undocumented)
    protected wrapFunctionWithResponse<A extends any[], R>(fn: (...args: A) => R): ResponsifiedFunction<A, R>;
}

// @public
interface CommonOptions {
    // (undocumented)
    addDirectory?: string | string[];
    // (undocumented)
    addZipFile?: string | string[];
    // (undocumented)
    childProcess?: boolean;
    // (undocumented)
    concurrency?: number;
    // (undocumented)
    gc?: boolean;
    // (undocumented)
    maxRetries?: number;
    // (undocumented)
    memorySize?: number;
    // (undocumented)
    mode?: "https" | "queue" | "auto";
    // (undocumented)
    packageJson?: string | object | false;
    // (undocumented)
    retentionInDays?: number;
    // (undocumented)
    speculativeRetryThreshold?: number;
    // (undocumented)
    timeout?: number;
    // (undocumented)
    webpackOptions?: webpack.Configuration;
}

// @public (undocumented)
interface CostAnalyzerConfiguration {
    // (undocumented)
    options: Options;
    // (undocumented)
    provider: "aws" | "google";
    // (undocumented)
    repetitionConcurrency: number;
    // (undocumented)
    repetitions: number;
}

// @public (undocumented)
declare function estimateWorkloadCost<T, K extends string>(fmodule: string, configurations: CostAnalyzerConfiguration[] | undefined, workload: Workload<T, K>, options?: Listr.ListrOptions): Promise<CostAnalysisProfile<K>[]>;

// @public (undocumented)
declare function faast<M extends object>(provider: "aws", fmodule: M, modulePath: string, options?: AwsOptions): Promise<CloudFunction<M, AwsOptions, AwsState>>;

// @public (undocumented)
declare function faast<M extends object>(provider: "google", fmodule: M, modulePath: string, options?: GoogleOptions): Promise<CloudFunction<M, GoogleOptions, State>>;

// @public (undocumented)
declare function faast<M extends object>(provider: "local", fmodule: M, modulePath: string, options?: LocalOptions): Promise<CloudFunction<M, LocalOptions, State_2>>;

// @public (undocumented)
declare function faast<M extends object, S>(provider: Provider, fmodule: M, modulePath: string, options?: CommonOptions): Promise<CloudFunction<M, CommonOptions, S>>;

// @public (undocumented)
declare class FaastError extends Error {
    // (undocumented)
    constructor(errObj: any, logUrl?: string);
    // (undocumented)
    logUrl?: string;
}

// @public (undocumented)
declare class FunctionCounters {
    // (undocumented)
    completed: number;
    // (undocumented)
    errors: number;
    // (undocumented)
    invocations: number;
    // (undocumented)
    retries: number;
    // (undocumented)
    toString(): string;
}

// @public (undocumented)
declare class FunctionCountersMap {
    // (undocumented)
    aggregate: FunctionCounters;
    // (undocumented)
    clear(): void;
    // (undocumented)
    fAggregate: FactoryMap<string, FunctionCounters>;
    // (undocumented)
    fIncremental: FactoryMap<string, FunctionCounters>;
    // (undocumented)
    incr(fn: string, key: keyof NonFunctionProperties<FunctionCounters>, n?: number): void;
    // (undocumented)
    resetIncremental(): void;
    // (undocumented)
    toString(): string;
}

// @public (undocumented)
declare class FunctionStats {
    // (undocumented)
    estimatedBilledTime: Statistics;
    // (undocumented)
    executionTime: Statistics;
    // (undocumented)
    localStartLatency: Statistics;
    // (undocumented)
    remoteStartLatency: Statistics;
    // (undocumented)
    returnLatency: Statistics;
    // (undocumented)
    sendResponseLatency: Statistics;
    // (undocumented)
    toString(): string;
}

// @public (undocumented)
declare class FunctionStatsEvent {
    // (undocumented)
    constructor(fn: string, counters: FunctionCounters, stats?: FunctionStats | undefined);
    // (undocumented)
    readonly counters: FunctionCounters;
    // (undocumented)
    readonly fn: string;
    // (undocumented)
    readonly stats?: FunctionStats | undefined;
    // (undocumented)
    toString(): string;
}

// @public (undocumented)
declare class FunctionStatsMap {
    // (undocumented)
    aggregate: FunctionStats;
    // (undocumented)
    clear(): void;
    // (undocumented)
    fAggregate: FactoryMap<string, FunctionStats>;
    // (undocumented)
    fIncremental: FactoryMap<string, FunctionStats>;
    // (undocumented)
    resetIncremental(): void;
    // (undocumented)
    toString(): string;
    // (undocumented)
    update(fn: string, key: keyof NonFunctionProperties<FunctionStats>, value: number): void;
}

// @public (undocumented)
declare class GoogleCloudFunction<M extends object = object> extends CloudFunction<M, GoogleOptions, State> {
}

// @public (undocumented)
declare const googleConfigurations: CostAnalyzerConfiguration[];

// @public (undocumented)
interface GoogleOptions extends CommonOptions {
    // (undocumented)
    gcWorker?: (services: GoogleServices, resources: GoogleResources) => Promise<void>;
    // (undocumented)
    googleCloudFunctionOptions?: cloudfunctions_v1.Schema$CloudFunction;
    // (undocumented)
    region?: string;
}

// @public (undocumented)
declare class LocalFunction<M extends object = object> extends CloudFunction<M, LocalOptions, State_2> {
}

// @public (undocumented)
interface LocalOptions extends CommonOptions {
    // (undocumented)
    gcWorker?: (tempdir: string) => Promise<void>;
}

// @public (undocumented)
declare type Promisified<M> = {
    [K in keyof M]: M[K] extends (...args: infer A) => infer R ? PromisifiedFunction<A, R> : never;
};

// @public (undocumented)
declare type PromisifiedFunction<A extends any[], R> = (...args: A) => Promise<Unpacked<R>>;

// @public (undocumented)
declare type Provider = "aws" | "google" | "local";

// @internal (undocumented)
declare const _providers: {
    // (undocumented)
    aws: CloudFunctionImpl<AwsOptions, AwsState>;
    // (undocumented)
    google: CloudFunctionImpl<GoogleOptions, State>;
    // (undocumented)
    local: CloudFunctionImpl<LocalOptions, State_2>;
};

// @internal (undocumented)
declare type Response<D> = ResponseDetails<Unpacked<D>>;

// @internal (undocumented)
interface ResponseDetails<D> {
    // (undocumented)
    executionId?: string;
    // (undocumented)
    executionTime?: number;
    // (undocumented)
    localStartLatency?: number;
    // (undocumented)
    logUrl?: string;
    // (undocumented)
    rawResponse: any;
    // (undocumented)
    remoteStartLatency?: number;
    // (undocumented)
    returnLatency?: number;
    // (undocumented)
    sendResponseLatency?: number;
    // (undocumented)
    value: Promise<D>;
}


// (No @packageDocumentation comment for this package)
