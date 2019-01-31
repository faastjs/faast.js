import * as Listr from "listr";
import { inspect } from "util";
import { faastify, Promisified, aws, google } from "./faast";
import { FunctionCounters, FunctionStats, CommonOptions } from "./provider";
import { f1, keys, Statistics, sum } from "./shared";
import { throttle } from "./throttle";
import { NonFunctionProperties } from "./types";

export type Metrics<K extends string> = { [key in K]: number };

export interface Workload<T, K extends string> {
    work: (module: Promisified<T>) => Promise<Metrics<K> | void>;
    summarize?: (summaries: Array<Metrics<K>>) => Metrics<K>;
    format?: (key: K, value: number) => string;
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
    provider: "aws" | "google";
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
            provider: "aws",
            repetitions: 10,
            options: { mode: "https", memorySize, timeout: 300, gc: false },
            repetitionConcurrency: 10
        });
    }
    return rv;
})();

export const googleConfigurations: CostAnalyzerConfiguration[] = (() => {
    const rv: CostAnalyzerConfiguration[] = [];
    for (const memorySize of GoogleCloudFunctionsMemorySizes) {
        rv.push({
            provider: "google",
            repetitions: 10,
            options: { mode: "https", memorySize, timeout: 300, gc: false },
            repetitionConcurrency: 10
        });
    }
    return rv;
})();

export interface CostAnalysisProfile<K extends string> {
    provider: string;
    options: Options;
    costEstimate: CostBreakdown;
    stats: FunctionStats;
    counters: FunctionCounters;
    config: CostAnalyzerConfiguration;
    metrics: Metrics<K>;
}

const ps = (stat: Statistics) => (stat.mean / 1000).toFixed(3);

function summarizeMean<K extends string>(metrics: Metrics<K>[]) {
    const stats: { [key in K]: Statistics } = {} as any;
    metrics.forEach(m =>
        keys(m).forEach(key => {
            if (!(key in stats)) {
                stats[key] = new Statistics();
            }
            stats[key].update(m[key]);
        })
    );
    const result = {} as Metrics<K>;
    keys(stats).forEach(key => {
        result[key] = stats[key].mean;
    });
    return result;
}

function defaultFormat<K extends string>(key: K, value: number) {
    return `${key}:${f1(value)}`;
}

async function estimate<T, K extends string>(
    fmodule: string,
    workload: Workload<T, K>,
    config: CostAnalyzerConfiguration
): Promise<CostAnalysisProfile<K>> {
    const { provider, repetitions, options, repetitionConcurrency } = config;
    const cloudFunc = await faastify(provider, require(fmodule), fmodule, options);
    const doWork = throttle({ concurrency: repetitionConcurrency }, workload.work);
    const results: Promise<Metrics<K> | void>[] = [];
    for (let i = 0; i < repetitions; i++) {
        results.push(doWork(cloudFunc.functions).catch(_ => {}));
    }
    const rv = (await Promise.all(results)).filter(r => r) as Metrics<K>[];
    await cloudFunc.cleanup();
    const costEstimate = await cloudFunc.costEstimate();
    const stats = cloudFunc.stats.aggregate;
    const counters = cloudFunc.counters.aggregate;
    let summarize = workload.summarize || summarizeMean;
    const metrics = summarize(rv);
    return {
        provider,
        options: cloudFunc.options,
        costEstimate,
        stats,
        counters,
        config,
        metrics
    };
}

export async function estimateWorkloadCost<T, K extends string>(
    fmodule: string,
    configurations: CostAnalyzerConfiguration[] = awsConfigurations,
    workload: Workload<T, K>,
    options?: Listr.ListrOptions
) {
    const scheduleEstimate = throttle<
        [string, Workload<T, K>, CostAnalyzerConfiguration],
        CostAnalysisProfile<K>
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
            const { provider, repetitions, options } = configurations[i];
            const { memorySize, mode } = options;

            return {
                title: `${provider} ${memorySize}MB ${mode}`,
                task: async (_: any, task: Listr.ListrTaskWrapper) => {
                    const est = await promise;
                    const total = (est.costEstimate.total() / repetitions).toFixed(8);
                    const { errors } = est.counters;
                    const message = `${ps(est.stats.executionLatency)}s $${total}`;
                    const errMessage = errors > 0 ? ` (${errors} errors)` : "";
                    const metrics = keys(est.metrics)
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

export function toCSV<K extends string>(
    profile: Array<CostAnalysisProfile<K>>,
    format?: (key: K, value: number) => string
) {
    const allKeys = new Set<K>();
    profile.forEach(profile => keys(profile.metrics).forEach(key => allKeys.add(key)));
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

        const metrics: { [key in K]: string } = {} as any;
        for (const key of allKeys) {
            metrics[key] = formatter(key, r.metrics[key]);
        }

        const row = {
            cloud: r.provider,
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
