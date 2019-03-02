// @public (undocumented)
declare const awsConfigurations: CostAnalyzerConfiguration[];

// @public
interface AwsOptions extends CommonOptions {
    awsLambdaOptions?: Partial<aws.Lambda.Types.CreateFunctionRequest>;
    CacheBucket?: string;
    // @internal (undocumented)
    gcWorker?: (services: AwsServices, work: AwsGcWork) => Promise<void>;
    region?: AwsRegion;
    RoleName?: string;
}

// @public
declare type AwsRegion = "us-east-1" | "us-east-2" | "us-west-1" | "us-west-2" | "ca-central-1" | "eu-central-1" | "eu-west-1" | "eu-west-2" | "eu-west-3" | "ap-northeast-1" | "ap-northeast-2" | "ap-northeast-3" | "ap-southeast-1" | "ap-southeast-2" | "ap-south-1" | "sa-east-1";

// @public
interface CleanupOptions {
    deleteResources?: boolean;
}

// @public (undocumented)
declare class CloudFunction<M extends object, O extends CommonOptions = CommonOptions, S = any> {
    // @internal
    constructor(impl: CloudFunctionImpl<O, S>, state: S, fmodule: M, modulePath: string, options: Required<CommonOptions>);
    // (undocumented)
    cleanup(userCleanupOptions?: CleanupOptions): Promise<void>;
    // (undocumented)
    cloudName: string;
    costEstimate(): Promise<CostBreakdown>;
    // @internal (undocumented)
    counters: FunctionCountersMap;
    // (undocumented)
    functions: Promisified<M>;
    logUrl(): string;
    off(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void): void;
    on(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void): void;
    // (undocumented)
    readonly options: Required<CommonOptions>;
    // (undocumented)
    readonly state: S;
    // @internal (undocumented)
    stats: FunctionStatsMap;
    }

// @public
interface CommonOptions {
    addDirectory?: string | string[];
    addZipFile?: string | string[];
    childProcess?: boolean;
    concurrency?: number;
    gc?: boolean;
    maxRetries?: number;
    memorySize?: number;
    mode?: "https" | "queue" | "auto";
    packageJson?: string | object;
    retentionInDays?: number;
    // @alpha
    speculativeRetryThreshold?: number;
    timeout?: number;
    useDependencyCaching?: boolean;
    webpackOptions?: webpack.Configuration;
}

// @public (undocumented)
interface CostAnalysisProfile<K extends string> {
    // (undocumented)
    config: CostAnalyzerConfiguration;
    // (undocumented)
    costEstimate: CostBreakdown;
    // (undocumented)
    counters: FunctionCounters;
    // (undocumented)
    metrics: Metrics<K>;
    // (undocumented)
    options: CommonOptions | AwsOptions | GoogleOptions;
    // (undocumented)
    provider: "aws" | "google";
    // (undocumented)
    stats: FunctionStats;
}

// @public (undocumented)
interface CostAnalyzerConfiguration {
    // (undocumented)
    options: AwsOptions | GoogleOptions | CommonOptions;
    // (undocumented)
    provider: "aws" | "google";
    // (undocumented)
    repetitionConcurrency: number;
    // (undocumented)
    repetitions: number;
}

// @public (undocumented)
declare class CostBreakdown {
    // (undocumented)
    csv(): string;
    // (undocumented)
    find(name: string): CostMetric | undefined;
    // (undocumented)
    metrics: CostMetric[];
    // (undocumented)
    push(metric: CostMetric): void;
    // (undocumented)
    toString(): string;
    // (undocumented)
    total(): number;
}

// @public (undocumented)
declare class CostMetric {
    // @internal (undocumented)
    constructor(opts?: NonFunctionProperties<CostMetric>);
    // (undocumented)
    comment?: string;
    // (undocumented)
    cost(): number;
    // (undocumented)
    describeCostOnly(): string;
    // (undocumented)
    informationalOnly?: boolean;
    // (undocumented)
    measured: number;
    // (undocumented)
    name: string;
    // (undocumented)
    pricing: number;
    // (undocumented)
    toString(): string;
    // (undocumented)
    unit: string;
    // (undocumented)
    unitPlural?: string;
}

// @public (undocumented)
declare function estimateWorkloadCost<T extends object, K extends string>(mod: T, fmodule: string, configurations: CostAnalyzerConfiguration[] | undefined, workload: Workload<T, K>): Promise<CostAnalysisProfile<K>[]>;

// @public
declare function faast<M extends object>(provider: "aws", fmodule: M, modulePath: string, awsOptions?: AwsOptions): Promise<CloudFunction<M, AwsOptions, AwsState>>;

// @public
declare function faast<M extends object>(provider: "google", fmodule: M, modulePath: string, googleOptions?: GoogleOptions): Promise<CloudFunction<M, GoogleOptions, GoogleState>>;

// @public
declare function faast<M extends object>(provider: "local", fmodule: M, modulePath: string, localOptions?: LocalOptions): Promise<CloudFunction<M, LocalOptions, LocalState>>;

// @public
declare function faast<M extends object, S>(provider: Provider, fmodule: M, modulePath: string, options?: CommonOptions): Promise<CloudFunction<M, CommonOptions, S>>;

// @public (undocumented)
declare class FaastError extends Error {
    // (undocumented)
    constructor(errObj: any, logUrl?: string);
    logUrl?: string;
}

// @public
declare class FunctionCounters {
    completed: number;
    errors: number;
    invocations: number;
    retries: number;
    toString(): string;
}

// @public
declare class FunctionStats {
    estimatedBilledTime: Statistics;
    executionTime: Statistics;
    localStartLatency: Statistics;
    remoteStartLatency: Statistics;
    returnLatency: Statistics;
    sendResponseLatency: Statistics;
    toString(): string;
}

// @public
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
declare const googleConfigurations: CostAnalyzerConfiguration[];

// @public
interface GoogleOptions extends CommonOptions {
    // @internal (undocumented)
    gcWorker?: (services: GoogleServices, resources: GoogleResources) => Promise<void>;
    googleCloudFunctionOptions?: cloudfunctions_v1.Schema$CloudFunction;
    region?: string;
}

// @public (undocumented)
interface Limits {
    // (undocumented)
    burst?: number;
    // (undocumented)
    cache?: PersistentCache;
    // (undocumented)
    concurrency: number;
    // (undocumented)
    memoize?: boolean;
    // (undocumented)
    rate?: number;
    // (undocumented)
    retry?: number | ((err: any, retries: number) => boolean);
}

// @public
interface LocalOptions extends CommonOptions {
    // @internal (undocumented)
    gcWorker?: (tempdir: string) => Promise<void>;
}

// @public
declare const log: {
    // (undocumented)
    info: default.Debugger;
    // (undocumented)
    warn: default.Debugger;
    // (undocumented)
    gc: default.Debugger;
    // (undocumented)
    leaks: default.Debugger;
    // (undocumented)
    calls: default.Debugger;
    // (undocumented)
    webpack: default.Debugger;
    // (undocumented)
    provider: default.Debugger;
    // (undocumented)
    awssdk: default.Debugger;
};

// @public (undocumented)
declare type Metrics<K extends string> = {
    [key in K]: number;
};

// @internal (undocumented)
declare const _parentModule: NodeModule | null;

// @public (undocumented)
declare type Promisified<M> = {
    [K in keyof M]: M[K] extends (...args: infer A) => infer R ? PromisifiedFunction<A, R> : never;
};

// @public (undocumented)
declare type PromisifiedFunction<A extends any[], R> = (...args: A) => Promise<Unpacked<R>>;

// @public
declare type Provider = "aws" | "google" | "local";

// @public (undocumented)
declare const providers: Provider[];

// @public
declare class Statistics {
    constructor(printFixedPrecision?: number);
    max: number;
    mean: number;
    min: number;
    // (undocumented)
    protected printFixedPrecision: number;
    samples: number;
    stdev: number;
    toString(): string;
    update(value: number): void;
    variance: number;
}

// @public
declare function throttle<A extends any[], R>({ concurrency, retry: retryN, rate, burst, memoize, cache }: Limits, fn: PromiseFn<A, R>): PromiseFn<A, R>;

// @public (undocumented)
declare function toCSV<K extends string>(profile: Array<CostAnalysisProfile<K>>, format?: (key: K, value: number) => string): string;

// @public (undocumented)
declare type Unpacked<T> = T extends Promise<infer D> ? D : T;

// @public (undocumented)
interface Workload<T extends object, K extends string> {
    // (undocumented)
    format?: (key: K, value: number) => string;
    // (undocumented)
    silent?: boolean;
    // (undocumented)
    summarize?: (summaries: Array<Metrics<K>>) => Metrics<K>;
    // (undocumented)
    work: (module: Promisified<T>) => Promise<Metrics<K> | void>;
}


// (No @packageDocumentation comment for this package)
