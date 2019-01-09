import * as Listr from "listr";
import { inspect } from "util";
import {
    aws,
    faastify,
    FunctionCounters,
    FunctionStats,
    google,
    Promisified
} from "./faast";
import { CommonOptions } from "./options";
import { Statistics, sum, f1, keys } from "./shared";
import { throttle } from "./throttle";
import { NonFunctionProperties } from "./types";

export interface WorkloadMetrics {
    [key: string]: number;
}

export interface Workload<T, S extends WorkloadMetrics> {
    work: (module: Promisified<T>) => Promise<S | void>;
    summarize?: (summaries: S[]) => S;
    format?: (key: keyof S, value: number) => string;
}

export class CostMetric {
    name!: string;
    pricing!: number;
    unit!: string;
    unitPlural?: string;
    measured!: number;
    comment?: string;
    alwaysZero?: boolean = false;

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
            options: { mode: "https", memorySize, timeout: 300 },
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
            options: { mode: "https", memorySize, timeout: 300 },
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
    metrics: WorkloadMetrics;
}

const ps = (stat: Statistics) => (stat.mean / 1000).toFixed(3);

function summarizeMean<S extends WorkloadMetrics>(metrics: S[]) {
    const stats: { [key: string]: Statistics } = {};
    metrics.forEach(m =>
        Object.keys(m).forEach(key => {
            if (!(key in stats)) {
                stats[key] = new Statistics();
            }
            stats[key].update(m[key]);
        })
    );
    const result = {} as S;
    Object.keys(stats).forEach(key => {
        result[key] = stats[key].mean;
    });
    return result;
}

function defaultFormat(key: string, value: number) {
    return `${key}:${f1(value)}`;
}

async function estimate<T, S extends WorkloadMetrics>(
    fmodule: string,
    workload: Workload<T, S>,
    config: CostAnalyzerConfiguration
): Promise<CostAnalysisProfile> {
    const { cloudProvider, repetitions, options, repetitionConcurrency } = config;
    const cloudFunc = await faastify(cloudProvider, require(fmodule), fmodule, options);
    const doWork = throttle({ concurrency: repetitionConcurrency }, workload.work);
    const results: Promise<S | void>[] = [];
    for (let i = 0; i < repetitions; i++) {
        results.push(doWork(cloudFunc.functions).catch(_ => {}));
    }
    const rv = (await Promise.all(results)).filter(r => r) as S[];
    await cloudFunc.cleanup();
    const costEstimate = await cloudFunc.costEstimate();
    const stats = cloudFunc.functionStats.aggregate;
    const counters = cloudFunc.functionCounters.aggregate;
    let summarize = workload.summarize || summarizeMean;
    const metrics = summarize(rv);
    return {
        cloudProvider,
        options,
        costEstimate,
        stats,
        counters,
        config,
        metrics
    };
}

export async function estimateWorkloadCost<T, S extends WorkloadMetrics>(
    fmodule: string,
    configurations: CostAnalyzerConfiguration[] = awsConfigurations,
    workload: Workload<T, S>,
    options?: Listr.ListrOptions
) {
    const scheduleEstimate = throttle<
        [string, Workload<T, S>, CostAnalyzerConfiguration],
        CostAnalysisProfile
    >(
        {
            concurrency: 8,
            rate: 4,
            burst: 1
        },
        estimate
    );

    const promises = configurations.map(config =>
        scheduleEstimate(fmodule, workload, config)
    );

    const format = workload.format || defaultFormat;

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
                    const metrics = Object.keys(est.metrics)
                        .map(k => format(k, est.metrics[k]))
                        .join(" ");
                    task.title = `${task.title} ${message}${errMessage} ${metrics}`;
                }
            };
        }),
        { concurrent: 8, ...options }
    );

    await list.run();
    const results = await Promise.all(promises);
    results.sort((a, b) => a.options.memorySize! - b.options.memorySize!);
    return results;
}

export function toCSV<S extends WorkloadMetrics>(
    profile: CostAnalysisProfile[],
    format?: (key: keyof S, value: number) => string
) {
    const allKeys = new Set<string>();
    profile.forEach(profile =>
        Object.keys(profile.metrics).forEach(key => allKeys.add(key))
    );
    const columns = [
        "cloud",
        "memory",
        "mode",
        "options",
        "completed",
        "errors",
        "retries",
        "cost",
        "executionLatency",
        "billedTime",
        ...allKeys
    ];
    let rv = columns.join(",") + "\n";

    const formatter = format || defaultFormat;
    profile.forEach(r => {
        const { memorySize, mode, ...rest } = r.options;
        const options = `"${inspect(rest).replace('"', '""')}"`;
        const { completed, errors, retries } = r.counters;
        const cost = (r.costEstimate.total() / r.config.repetitions).toFixed(8);

        const metrics: { [key: string]: string } = {};
        for (const key of allKeys) {
            metrics[key] = formatter(key, r.metrics[key]);
        }

        const row = {
            cloud: r.cloudProvider,
            memory: memorySize,
            mode: mode,
            options: options,
            completed,
            errors,
            retries,
            cost: `$${cost}`,
            executionLatency: ps(r.stats.executionLatency),
            billedTime: ps(r.stats.estimatedBilledTime),
            ...metrics
        };

        rv += keys(row)
            .map(k => String(row[k]))
            .join(",");
        rv += "\n";
    });
    return rv;
}
