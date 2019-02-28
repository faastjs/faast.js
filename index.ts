export const parentModule = module.parent;
export const parentRequire = module.parent!.require;

export {
    AwsMetrics,
    AwsOptions,
    AwsRegion,
    AwsResources,
    AwsState
} from "./src/aws/aws-faast";
export {
    awsConfigurations,
    CostAnalysisProfile,
    CostAnalyzerConfiguration,
    CostBreakdown,
    CostMetric,
    estimateWorkloadCost,
    googleConfigurations,
    Metrics,
    toCSV,
    Workload
} from "./src/cost";
export {
    CloudFunction,
    faast,
    FaastError,
    FunctionStatsEvent,
    Promisified,
    PromisifiedFunction,
    Provider,
    providers
} from "./src/faast";
export {
    GoogleMetrics,
    GoogleOptions,
    GoogleResources,
    GoogleState
} from "./src/google/google-faast";
export { LocalOptions, LocalState } from "./src/local/local-faast";
export {
    info,
    logCalls,
    logGc,
    logLeaks,
    logProvider,
    logProviderSdk,
    logWebpack,
    warn
} from "./src/log";
export {
    CleanupOptions,
    CommonOptions,
    FunctionCounters,
    FunctionStats
} from "./src/provider";
export { Statistics } from "./src/shared";
export { Pump, throttle } from "./src/throttle";
export { Unpacked } from "./src/types";
