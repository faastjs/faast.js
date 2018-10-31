import { inspect } from "util";
import {
    aws,
    CommonOptions,
    create,
    FunctionCounters,
    FunctionStats,
    google,
    Promisified
} from "./cloudify";
import { Funnel, RateLimitedFunnel } from "./funnel";
import { log } from "./log";
import { Statistics, sum } from "./shared";
import { NonFunctionProperties } from "./type-helpers";
import * as Listr from "listr";

export class CostMetric {
    name!: string;
    pricing!: number;
    unit!: string;
    unitPlural?: string;
    measured!: number;
    comment?: string;

    constructor(opts?: NonFunctionProperties<CostMetric>) {
        Object.assign(this, opts);
    }

    cost() {
        return this.pricing * this.measured;
    }

    describeCostOnly() {
        const p = (n: number, precision = 8) =>
            Number.isInteger(n) ? String(n) : n.toFixed(precision);
        const getUnit = (n: number) => {
            if (n > 1) {
                return (
                    this.unitPlural ||
                    (!this.unit.match(/[A-Z]$/) ? this.unit + "s" : this.unit)
                );
            } else {
                return this.unit;
            }
        };

        const cost = `$${p(this.cost())}`;
        const pricing = `$${p(this.pricing)}/${this.unit}`;
        const metric = p(this.measured, this.unit === "second" ? 1 : 8);
        const unit = getUnit(this.measured);

        return `${this.name.padEnd(21)} ${pricing.padEnd(20)} ${metric.padStart(
            12
        )} ${unit.padEnd(10)} ${cost.padEnd(14)}`;
    }

    toString() {
        return `${this.describeCostOnly()}${(this.comment && `// ${this.comment}`) ||
            ""}`;
    }
}

export class CostBreakdown {
    metrics: CostMetric[] = [];

    total() {
        return sum(this.metrics.map(metric => metric.cost()));
    }

    toString() {
        let rv = "";
        this.metrics.sort((a, b) => b.cost() - a.cost());
        const total = this.total();
        const comments = [];
        const percent = (entry: CostMetric) =>
            ((entry.cost() / total) * 100).toFixed(1).padStart(5) + "% ";
        for (const entry of this.metrics) {
            let commentIndex = "";
            if (entry.comment) {
                comments.push(entry.comment);
                commentIndex = ` [${comments.length}]`;
            }
            rv += `${entry.describeCostOnly()}${percent(entry)}${commentIndex}\n`;
        }
        rv +=
            "---------------------------------------------------------------------------------------\n";
        rv += `$${this.total().toFixed(8)}`.padStart(78) + " (USD)\n\n";
        rv += `  * Estimated using highest pricing tier for each service. Limitations apply.\n`;
        rv += ` ** Does not account for free tier.\n`;
        rv += comments.map((c, i) => `[${i + 1}]: ${c}`).join("\n");
        return rv;
    }

    csv() {
        let rv = "";
        rv += "metric,unit,pricing,measured,cost,percentage,comment\n";
        const total = this.total();
        const p = (n: number) => (Number.isInteger(n) ? n : n.toFixed(8));
        const percent = (entry: CostMetric) =>
            ((entry.cost() / total) * 100).toFixed(1) + "% ";
        for (const entry of this.metrics) {
            rv += `${entry.name},${entry.unit},${p(entry.pricing)},${p(
                entry.measured
            )},${p(entry.cost())},${percent(entry)},"${entry.comment!.replace(
                '"',
                '""'
            )}"\n`;
        }
        return rv;
    }

    push(metric: CostMetric) {
        this.metrics.push(metric);
    }

    find(name: string) {
        return this.metrics.find(m => m.name === name);
    }
}

export type Options = CommonOptions | aws.Options | google.Options;

export interface CostAnalyzerConfiguration {
    cloudProvider: "aws" | "google";
    repetitions: number;
    options: Options;
    repetitionConcurrency: number;
}

export const AWSLambdaMemorySizes = (() => {
    const rv = [];
    for (let memorySize = 128; memorySize <= 3008; memorySize += 64) {
        rv.push(memorySize);
    }
    return rv;
})();

export const GoogleCloudFunctionsMemorySizes = [128, 256, 512, 1024, 2048];

export const CommonMemorySizes = GoogleCloudFunctionsMemorySizes.filter(size =>
    AWSLambdaMemorySizes.find(asize => asize === size)
);

export const awsConfigurations: CostAnalyzerConfiguration[] = (() => {
    const rv: CostAnalyzerConfiguration[] = [];
    for (const memorySize of AWSLambdaMemorySizes) {
        rv.push({
            cloudProvider: "aws",
            repetitions: 10,
            options: { mode: "https", memorySize, timeout: 120 },
            repetitionConcurrency: 10
        });
    }
    return rv;
})();

export const googleConfigurations: CostAnalyzerConfiguration[] = (() => {
    const rv: CostAnalyzerConfiguration[] = [];
    for (const memorySize of GoogleCloudFunctionsMemorySizes) {
        rv.push({
            cloudProvider: "google",
            repetitions: 10,
            options: { mode: "https", memorySize, timeout: 120 },
            repetitionConcurrency: 10
        });
    }
    return rv;
})();

export interface CostAnalysisProfile {
    cloudProvider: string;
    options: Options;
    costEstimate: CostBreakdown;
    stats: FunctionStats;
    counters: FunctionCounters;
    config: CostAnalyzerConfiguration;
}

const ps = (stat: Statistics) => (stat.mean / 1000).toFixed(3);

async function estimate<T>(
    fmodule: string,
    workload: (module: Promisified<T>) => Promise<void>,
    config: CostAnalyzerConfiguration
): Promise<CostAnalysisProfile> {
    const { cloudProvider, repetitions, options, repetitionConcurrency } = config;
    const cloud = create(cloudProvider);
    const cloudFunction = await cloud.createFunction(fmodule, options);
    const remote = cloudFunction.cloudifyModule(require(fmodule)) as Promisified<T>;
    const funnel = new Funnel<void | Error>(repetitionConcurrency);
    const results = [];
    for (let i = 0; i < repetitions; i++) {
        results.push(funnel.push(() => workload(remote).catch((err: Error) => err)));
    }
    await Promise.all(results);
    await cloudFunction.cleanup();
    const costEstimate = await cloudFunction.costEstimate();
    const stats = cloudFunction.functionStats.aggregate;
    const counters = cloudFunction.functionCounters.aggregate;
    return { cloudProvider, options, costEstimate, stats, counters, config };
}

export async function estimateWorkloadCost<T>(
    fmodule: string,
    workload: (remote: Promisified<T>) => Promise<void>,
    configurations: CostAnalyzerConfiguration[] = awsConfigurations
) {
    const funnel = new RateLimitedFunnel<CostAnalysisProfile>({
        maxConcurrency: 8,
        targetRequestsPerSecond: 4,
        maxBurst: 1
    });

    const promises = configurations.map(config =>
        funnel.push(() => estimate(fmodule, workload, config))
    );

    const list = new Listr(
        promises.map((promise, i) => {
            const { cloudProvider, repetitions, options } = configurations[i];
            const { memorySize, mode } = options;

            return {
                title: `${cloudProvider} ${memorySize}MB ${mode}`,
                task: async (_: any, task: Listr.ListrTaskWrapper) => {
                    const est = await promise;
                    const total = (est.costEstimate.total() / repetitions).toFixed(8);
                    const { errors } = est.counters;
                    const message = `${ps(est.stats.executionLatency)}s $${total}`;
                    const errMessage = errors > 0 ? ` (${errors} errors)` : "";

                    task.title = `${task.title} ${message}${errMessage}`;
                }
            };
        }),
        { concurrent: 8 }
    );

    await list.run();
    const results = await Promise.all(promises);
    results.sort((a, b) => a.options.memorySize! - b.options.memorySize!);
    return results;
}

export function toCSV(profile: CostAnalysisProfile[]) {
    let rv = "";
    rv += `cloud,memory,useQueue,options,completed,errors,retries,cost,executionLatency,billedTime\n`;
    profile.forEach(r => {
        const { memorySize, mode, ...rest } = r.options;
        const options = `"${inspect(rest).replace('"', '""')}"`;
        const { completed, errors, retries } = r.counters;
        const cost = (r.costEstimate.total() / r.config.repetitions).toFixed(8);

        rv += `${
            r.cloudProvider
        },${memorySize},${mode},${options},${completed},${errors},${retries},$${cost},${ps(
            r.stats.executionLatency
        )},${ps(r.stats.estimatedBilledTime)}\n`;
    });
    return rv;
}
