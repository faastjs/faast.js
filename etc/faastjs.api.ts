// @public (undocumented)
declare const awsConfigurations: CostAnalyzerConfiguration[];

// @public
declare type AwsModule<M extends object = object> = FaastModuleProxy<M, AwsOptions, AwsState>;

// @public
interface AwsOptions extends CommonOptions {
    awsLambdaOptions?: Partial<aws.Lambda.Types.CreateFunctionRequest>;
    // @internal (undocumented)
    gcWorker?: (work: AwsGcWork, services: AwsServices) => Promise<void>;
    region?: AwsRegion;
    RoleName?: string;
}

// @public
declare type AwsRegion = "us-east-1" | "us-east-2" | "us-west-1" | "us-west-2" | "ca-central-1" | "eu-central-1" | "eu-west-1" | "eu-west-2" | "eu-west-3" | "ap-northeast-1" | "ap-northeast-2" | "ap-northeast-3" | "ap-southeast-1" | "ap-southeast-2" | "ap-south-1" | "sa-east-1";

// @public
interface CleanupOptions {
    deleteCaches?: boolean;
    deleteResources?: boolean;
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
declare type CostAnalyzerConfiguration = {
    // (undocumented)
    provider: "aws";
    // (undocumented)
    options: AwsOptions;
} | {
    // (undocumented)
    provider: "google";
    // (undocumented)
    options: GoogleOptions;
};

// @public
declare class CostMetric {
    // @internal (undocumented)
    constructor(arg: PropertiesExcept<CostMetric, AnyFunction>);
    // (undocumented)
    readonly comment?: string;
    // (undocumented)
    cost(): number;
    // (undocumented)
    describeCostOnly(): string;
    // (undocumented)
    readonly informationalOnly?: boolean;
    // (undocumented)
    readonly measured: number;
    // (undocumented)
    readonly name: string;
    // (undocumented)
    readonly pricing: number;
    // (undocumented)
    toString(): string;
    // (undocumented)
    readonly unit: string;
    // (undocumented)
    readonly unitPlural?: string;
}

// @public (undocumented)
declare class CostSnapshot {
    // (undocumented)
    constructor(provider: string, options: CommonOptions | AwsOptions | GoogleOptions, stats: FunctionStats, costMetrics?: CostMetric[]);
    // (undocumented)
    readonly costMetrics: CostMetric[];
    // (undocumented)
    csv(): string;
    // (undocumented)
    find(name: string): CostMetric | undefined;
    // (undocumented)
    readonly options: CommonOptions | AwsOptions | GoogleOptions;
    // (undocumented)
    readonly provider: string;
    // (undocumented)
    push(metric: CostMetric): void;
    // (undocumented)
    readonly stats: FunctionStats;
    // (undocumented)
    toString(): string;
    // (undocumented)
    total(): number;
}

// @public (undocumented)
declare function estimateWorkloadCost<T extends object, A extends string>(mod: T, fmodule: string, configurations: CostAnalyzerConfiguration[] | undefined, workload: Workload<T, A>, repetitions?: number, repetitionConcurrency?: number): Promise<WorkloadCostAnalyzerResult<T, A>>;

// @public
declare function faast<M extends object>(provider: Provider, fmodule: M, modulePath: string, options?: CommonOptions): Promise<FaastModule<M>>;

// @public
declare function faastAws<M extends object>(fmodule: M, modulePath: string, options?: AwsOptions): Promise<AwsModule<M>>;

// @public
declare class FaastError extends Error {
    // @internal (undocumented)
    constructor(errObj: any, logUrl?: string);
    [key: string]: any;
    logUrl?: string;
}

// @public
declare function faastGoogle<M extends object>(fmodule: M, modulePath: string, options?: GoogleOptions): Promise<GoogleModule<M>>;

// @public
declare function faastLocal<M extends object>(fmodule: M, modulePath: string, options?: LocalOptions): Promise<LocalModule<M>>;

// @public
interface FaastModule<M extends object> {
    cleanup(options?: CleanupOptions): Promise<void>;
    costSnapshot(): Promise<CostSnapshot>;
    functions: Promisified<M>;
    logUrl(): string;
    off(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void): void;
    on(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void): void;
    provider: Provider;
    stats(functionName?: string): FunctionStats;
}

// @public
declare class FaastModuleProxy<M extends object, O, S> implements FaastModule<M> {
    // @internal
    constructor(impl: ProviderImpl<O, S>, state: S, fmodule: M, modulePath: string, options: Required<CommonOptions>);
    // (undocumented)
    cleanup(userCleanupOptions?: CleanupOptions): Promise<void>;
    // (undocumented)
    costSnapshot(): Promise<CostSnapshot>;
    // (undocumented)
    functions: Promisified<M>;
    // (undocumented)
    logUrl(): string;
    // (undocumented)
    off(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void): void;
    // (undocumented)
    on(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void): void;
    // (undocumented)
    readonly options: Required<CommonOptions>;
    // (undocumented)
    provider: Provider;
    // (undocumented)
    readonly state: S;
    // (undocumented)
    stats(functionName?: string): FunctionStats;
    }

// @public
declare class FunctionStats {
    // @internal (undocumented)
    clone(): FunctionStats;
    completed: number;
    errors: number;
    estimatedBilledTime: Statistics;
    executionTime: Statistics;
    invocations: number;
    localStartLatency: Statistics;
    remoteStartLatency: Statistics;
    retries: number;
    returnLatency: Statistics;
    sendResponseLatency: Statistics;
    // (undocumented)
    toString(): string;
}

// @public
declare class FunctionStatsEvent {
    // (undocumented)
    constructor(fn: string, stats: FunctionStats);
    // (undocumented)
    readonly fn: string;
    // (undocumented)
    readonly stats: FunctionStats;
    toString(): string;
}

// @public (undocumented)
declare const googleConfigurations: CostAnalyzerConfiguration[];

// @public
declare type GoogleModule<M extends object = object> = FaastModuleProxy<M, GoogleOptions, GoogleState>;

// @public
interface GoogleOptions extends CommonOptions {
    // @internal (undocumented)
    gcWorker?: (resources: GoogleResources, services: GoogleServices) => Promise<void>;
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
declare type LocalModule<M extends object = object> = FaastModuleProxy<M, LocalOptions, LocalState>;

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

// @internal (undocumented)
declare const _parentModule: NodeModule | null;

// @public
declare type Promisified<M> = {
    [K in keyof M]: M[K] extends (...args: infer A) => infer R ? PromisifiedFunction<A, R> : never;
};

// @public
declare type PromisifiedFunction<A extends any[], R> = (...args: A) => Promise<Unpacked<R>>;

// @public
declare type Provider = "aws" | "google" | "local";

// @public (undocumented)
declare const providers: Provider[];

// @public
declare class Statistics {
    constructor(printFixedPrecision?: number);
    // @internal (undocumented)
    clone(): Statistics & this;
    max: number;
    mean: number;
    min: number;
    // (undocumented)
    protected printFixedPrecision: number;
    samples: number;
    stdev: number;
    toString(): string;
    update(value: number | undefined): void;
    variance: number;
}

// @public
declare function throttle<A extends any[], R>({ concurrency, retry, rate, burst, memoize, cache }: Limits, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R>;

// @public (undocumented)
declare type Unpacked<T> = T extends Promise<infer D> ? D : T;

// @public (undocumented)
interface Workload<T extends object, A extends string> {
    // (undocumented)
    format?: (attr: A, value: number) => string;
    // (undocumented)
    formatCSV?: (attr: A, value: number) => string;
    // (undocumented)
    silent?: boolean;
    // (undocumented)
    summarize?: (summaries: WorkloadAttribute<A>[]) => WorkloadAttribute<A>;
    // (undocumented)
    work: (module: Promisified<T>) => Promise<WorkloadAttribute<A> | void>;
}

// @public (undocumented)
declare type WorkloadAttribute<A extends string> = {
    [attr in A]: number;
};


// (No @packageDocumentation comment for this package)
