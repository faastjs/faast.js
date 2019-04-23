/**
 * Faast.js transforms ordinary JavaScript modules into serverless cloud
 * functions that can run on AWS Lambda and Google Cloud Functions.
 *
 * The main entry point to faast.js is the {@link faast} function, which returns
 * an object that implements the {@link FaastModule} interface. The most common
 * options are {@link CommonOptions}. Using faast.js requires writing two
 * modules, one containing the functions to upload to the cloud, and the other
 * that invokes faast.js and calls the resulting cloud functions.
 * @packageDocumentation
 */
export { AwsOptions, AwsRegion } from "./src/aws/aws-faast";
export { PersistentCache } from "./src/cache";
export { CostAnalyzer, CostMetric, CostSnapshot } from "./src/cost";
export { FaastError } from "./src/error";
export {
    AwsFaastModule,
    faast,
    faastAws,
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
export { GoogleOptions, GoogleRegion } from "./src/google/google-faast";
export { LocalOptions } from "./src/local/local-faast";
export { log } from "./src/log";
export { CleanupOptions, CommonOptions, FunctionStats, Provider } from "./src/provider";
export { Statistics } from "./src/shared";
export { Limits, throttle } from "./src/throttle";
export { Unpacked } from "./src/types";

/** @internal */
export const _parentModule = module.parent;
