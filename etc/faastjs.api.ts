// @public (undocumented)
declare const awsConfigurations: CostAnalyzerConfiguration[];

// @public (undocumented)
declare class AwsMetrics {
    // (undocumented)
    outboundBytes: number;
    // (undocumented)
    sns64kRequests: number;
    // (undocumented)
    sqs64kRequests: number;
}

// @public (undocumented)
interface AwsOptions extends CommonOptions {
    // (undocumented)
    awsLambdaOptions?: Partial<aws.Lambda.Types.CreateFunctionRequest>;
    // (undocumented)
    CacheBucket?: string;
    // @internal (undocumented)
    gcWorker?: (services: AwsServices, work: AwsGcWork) => Promise<void>;
    // (undocumented)
    PolicyArn?: string;
    // (undocumented)
    region?: AwsRegion;
    // (undocumented)
    RoleName?: string;
    // (undocumented)
    useDependencyCaching?: boolean;
}

// @public
declare type AwsRegion = "us-east-1" | "us-east-2" | "us-west-1" | "us-west-2" | "ca-central-1" | "eu-central-1" | "eu-west-1" | "eu-west-2" | "eu-west-3" | "ap-northeast-1" | "ap-northeast-2" | "ap-northeast-3" | "ap-southeast-1" | "ap-southeast-2" | "ap-south-1" | "sa-east-1";

// @public (undocumented)
interface AwsResources {
    // (undocumented)
    FunctionName: string;
    // (undocumented)
    logGroupName: string;
    // (undocumented)
    region: AwsRegion;
    // (undocumented)
    RequestTopicArn?: string;
    // (undocumented)
    ResponseQueueArn?: string;
    // (undocumented)
    ResponseQueueUrl?: string;
    // (undocumented)
    RoleName: string;
    // (undocumented)
    s3Bucket?: string;
    // (undocumented)
    s3Key?: string;
    // (undocumented)
    SNSLambdaSubscriptionArn?: string;
}

// @public (undocumented)
interface AwsState {
    // @internal (undocumented)
    gcPromise?: Promise<void>;
    // (undocumented)
    metrics: AwsMetrics;
    // (undocumented)
    options: Required<AwsOptions>;
    // (undocumented)
    resources: AwsResources;
    // @internal (undocumented)
    services: AwsServices;
}

// @public (undocumented)
interface CleanupOptions {
    // (undocumented)
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
    // (undocumented)
    costEstimate(): Promise<CostBreakdown>;
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
    readonly state: S;
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
declare function estimateWorkloadCost<T, K extends string>(fmodule: string, configurations: CostAnalyzerConfiguration[] | undefined, workload: Workload<T, K>): Promise<CostAnalysisProfile<K>[]>;

// @public (undocumented)
declare function faast<M extends object>(provider: "aws", fmodule: M, modulePath: string, options?: AwsOptions): Promise<CloudFunction<M, AwsOptions, AwsState>>;

// @public (undocumented)
declare function faast<M extends object>(provider: "google", fmodule: M, modulePath: string, options?: GoogleOptions): Promise<CloudFunction<M, GoogleOptions, GoogleState>>;

// @public (undocumented)
declare function faast<M extends object>(provider: "local", fmodule: M, modulePath: string, options?: LocalOptions): Promise<CloudFunction<M, LocalOptions, LocalState>>;

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
declare const googleConfigurations: CostAnalyzerConfiguration[];

// @public (undocumented)
declare class GoogleMetrics {
    // (undocumented)
    outboundBytes: number;
    // (undocumented)
    pubSubBytes: number;
}

// @public (undocumented)
interface GoogleOptions extends CommonOptions {
    // @internal (undocumented)
    gcWorker?: (services: GoogleServices, resources: GoogleResources) => Promise<void>;
    // (undocumented)
    googleCloudFunctionOptions?: cloudfunctions_v1.Schema$CloudFunction;
    // (undocumented)
    region?: string;
}

// @public (undocumented)
interface GoogleResources {
    // (undocumented)
    region: string;
    // (undocumented)
    requestQueueTopic?: string;
    // (undocumented)
    responseQueueTopic?: string;
    // (undocumented)
    responseSubscription?: string;
    // (undocumented)
    trampoline: string;
}

// @public (undocumented)
interface GoogleState {
    // (undocumented)
    functionName: string;
    // @internal (undocumented)
    gcPromise?: Promise<void>;
    // (undocumented)
    metrics: GoogleMetrics;
    // (undocumented)
    options: Required<GoogleOptions>;
    // (undocumented)
    project: string;
    // (undocumented)
    resources: GoogleResources;
    // @internal (undocumented)
    services: GoogleServices;
    // (undocumented)
    url?: string;
}

// @public (undocumented)
interface LocalOptions extends CommonOptions {
    // @internal (undocumented)
    gcWorker?: (tempdir: string) => Promise<void>;
}

// @public (undocumented)
interface LocalState {
    // @internal (undocumented)
    gcPromise?: Promise<void>;
    // @internal (undocumented)
    getWrapper: () => Promise<Wrapper>;
    // @internal (undocumented)
    logStreams: Writable[];
    // (undocumented)
    logUrl: string;
    // @internal (undocumented)
    queue: AsyncQueue<ReceivableMessage>;
    // (undocumented)
    tempDir: string;
    // @internal (undocumented)
    wrappers: Wrapper[];
}

// @public (undocumented)
declare type Metrics<K extends string> = {
    [key in K]: number;
};

// @public (undocumented)
declare type Promisified<M> = {
    [K in keyof M]: M[K] extends (...args: infer A) => infer R ? PromisifiedFunction<A, R> : never;
};

// @public (undocumented)
declare type PromisifiedFunction<A extends any[], R> = (...args: A) => Promise<Unpacked<R>>;

// @public (undocumented)
declare type Provider = "aws" | "google" | "local";

// @public (undocumented)
declare class Statistics {
    // (undocumented)
    constructor(printFixedPrecision?: number);
    // (undocumented)
    max: number;
    // (undocumented)
    mean: number;
    // (undocumented)
    min: number;
    // (undocumented)
    protected printFixedPrecision: number;
    // (undocumented)
    samples: number;
    // (undocumented)
    stdev: number;
    // (undocumented)
    toString(): string;
    // (undocumented)
    update(value: number): void;
    // (undocumented)
    variance: number;
}

// @public (undocumented)
declare function toCSV<K extends string>(profile: Array<CostAnalysisProfile<K>>, format?: (key: K, value: number) => string): string;

// @public (undocumented)
declare type Unpacked<T> = T extends Promise<infer D> ? D : T;

// @public (undocumented)
interface Workload<T, K extends string> {
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
