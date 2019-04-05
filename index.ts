/// <reference path="./types/proctor.d.ts" />

/**
 * Faast.js transforms ordinary JavaScript modules into serverless cloud
 * functions that can run on AWS Lambda and Google Cloud Functions.
 *
 * The main entry point to faast.js is the {@link faast} function, which returns
 * an object that implements the {@link FaastModule} interface. The most common
 * options are {@link CommonOptions}. Using faast.js requires writing two
 * modules, one containing the functions to upload to the cloud, and the other
 * that invokes faast.js and calls the resulting cloud functions:
 *
 * ```typescript
 * // functions.ts
 * export function hello(name: string) {
 *     return "hello " + name;
 * }
 * ```
 *
 * ```typescript
 * // main.ts
 * import { faast } from "faastjs";
 * import * as funcs from "./functions";
 * async function main() {
 *     const faastModule = await faast("local", funcs, "./functions");
 *     try {
 *         const result = await faastModule.functions.hello("world!");
 *         console.log(result);
 *     } finally {
 *         await faastModule.cleanup();
 *     }
 * }
 * main();
 * ```
 * @packageDocumentation
 */
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
