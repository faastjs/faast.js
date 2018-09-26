import {
    CloudProvider,
    CommonOptions,
    CostBreakdown,
    create,
    Promisified,
    aws,
    google,
    FunctionStats,
    FunctionCounters
} from "./cloudify";
import { Funnel, RateLimitedFunnel } from "./funnel";
import { log } from "./log";
import { inspect } from "util";
import { Statistics } from "./shared";

export type Options = CommonOptions | aws.Options | google.Options;

export interface CostAnalyzerConfiguration {
    cloudProvider: "aws" | "google";
    useQueue: boolean[];
    repetitions: number;
    memorySizes: number[];
    options: Options[];
    repetitionConcurrency: number;
    memorySizeConcurrency: number;
}

export const AWSLambdaMemorySizes = (() => {
    const rv = [];
    for (let memorySize = 128; memorySize <= 3008; memorySize += 64) {
        rv.push(memorySize);
    }
    log(`Memory sizes count: ${rv.length}`);
    return rv;
})();

export const GoogleCloudFunctionsMemorySizes = [128, 256, 512, 1024, 2048];

export const CommonMemorySizes = GoogleCloudFunctionsMemorySizes.filter(size =>
    AWSLambdaMemorySizes.find(asize => asize === size)
);

export const defaultAwsConfiguration: CostAnalyzerConfiguration = {
    cloudProvider: "aws",
    useQueue: [true, false],
    repetitions: 10,
    memorySizes: AWSLambdaMemorySizes,
    options: [{}],
    repetitionConcurrency: 10,
    memorySizeConcurrency: 8
};

export const defaulGoogleConfiguration: CostAnalyzerConfiguration = {
    cloudProvider: "google",
    useQueue: [true, false],
    repetitions: 10,
    memorySizes: GoogleCloudFunctionsMemorySizes,
    options: [{}],
    repetitionConcurrency: 10,
    memorySizeConcurrency: 5
};

interface CostAnalysisProfile {
    cloudProvider: string;
    options: Options;
    costEstimate: CostBreakdown;
    stats: FunctionStats;
    counters: FunctionCounters;
}

async function estimate<T>(
    cloudProvider: CloudProvider,
    fmodule: string,
    workload: (module: Promisified<T>) => Promise<void>,
    repetitions: number,
    concurrency: number,
    options: Options
): Promise<CostAnalysisProfile> {
    const cloud = create(cloudProvider);
    const cloudFunction = await cloud.createFunction(fmodule, options);
    const remote = cloudFunction.cloudifyModule(require(fmodule)) as Promisified<T>;
    const funnel = new Funnel<void | Error>(concurrency);
    const results = [];
    for (let i = 0; i < repetitions; i++) {
        results.push(funnel.push(() => workload(remote).catch((err: Error) => err)));
    }
    await Promise.all(results);
    await cloudFunction.cleanup();
    return {
        cloudProvider,
        options,
        costEstimate: await cloudFunction.costEstimate(),
        stats: cloudFunction.functionStats.aggregate,
        counters: cloudFunction.functionCounters.aggregate
    };
}

async function runConfig<T>(
    fmodule: string,
    workload: (remote: Promisified<T>) => Promise<void>,
    config: CostAnalyzerConfiguration
) {
    const funnel = new RateLimitedFunnel<CostAnalysisProfile>({
        maxConcurrency: config.memorySizeConcurrency,
        targetRequestsPerSecond: 4,
        maxBurst: 1
    });
    const promises: Array<Promise<CostAnalysisProfile>> = [];
    config.memorySizes.forEach(memorySize =>
        config.useQueue.forEach(useQueue =>
            config.options.forEach(options =>
                promises.push(
                    funnel.push(() =>
                        estimate(
                            config.cloudProvider,
                            fmodule,
                            workload,
                            config.repetitions,
                            config.repetitionConcurrency,
                            {
                                memorySize,
                                useQueue,
                                ...(options as any)
                            }
                        )
                    )
                )
            )
        )
    );
    const results = await Promise.all(promises);
    results.forEach(result => log(`${result.costEstimate}`));
    return results;
}

export async function costAnalyzer<T>(
    fmodule: string,
    workload: (remote: Promisified<T>) => Promise<void>,
    configurations: CostAnalyzerConfiguration[] = [defaultAwsConfiguration]
) {
    const allConfigs = await Promise.all(
        configurations.map(config => runConfig(fmodule, workload, config))
    );
    let results: CostAnalysisProfile[] = [];
    results = results.concat(...allConfigs);
    results.sort((a, b) => a.options.memorySize! - b.options.memorySize!);

    return results;
}

export function toCSV(profile: CostAnalysisProfile[]) {
    const p = (stat: Statistics) => (stat.mean / 1000).toFixed(3);
    let rv = "";
    rv += `cloud,memory,useQueue,options,completed,errors,retries,cost,executionLatency,billedTime\n`;
    profile.forEach(r => {
        const { memorySize, useQueue, ...rest } = r.options;
        const cost = r.costEstimate.estimateTotal().toFixed(8);
        const options = `"${inspect(rest).replace('"', '""')}"`;
        const { completed, errors, retries } = r.counters;
        rv += `${
            r.cloudProvider
        },${memorySize},${useQueue},${options},${completed},${errors},${retries},$${cost},${p(
            r.stats.executionLatency
        )},${p(r.stats.estimatedBilledTime)}\n`;
    });
    return rv;
}
