export { AwsOptions, AwsRegion } from "./src/aws/aws-faast";
export { PersistentCache } from "./src/cache";
export { CostAnalyzer, CostMetric, CostSnapshot } from "./src/cost";
export {
    AwsFaastModule,
    faast,
    faastAws,
    FaastError,
    faastGoogle,
    faastLocal,
    FaastModule,
    FaastModuleProxy,
    FunctionStatsEvent,
    GoogleFaastModule,
    LocalFaastModule,
    Promisified,
    PromisifiedFunction,
    providers
} from "./src/faast";
export { GoogleOptions } from "./src/google/google-faast";
export { LocalOptions } from "./src/local/local-faast";
export { log } from "./src/log";
export { CleanupOptions, CommonOptions, FunctionStats, Provider } from "./src/provider";
export { Statistics } from "./src/shared";
export { Limits, throttle } from "./src/throttle";
export { Unpacked } from "./src/types";

/** @internal */
export const _parentModule = module.parent;
