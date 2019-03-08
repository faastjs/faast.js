import * as Listr from "listr";
import { inspect } from "util";
import { faast, Promisified } from "../index";
import { AwsOptions } from "./aws/aws-faast";
import { GoogleOptions } from "./google/google-faast";
import { FunctionCounters, FunctionStats, CommonOptions } from "./provider";
import { f1, keys, Statistics, sum } from "./shared";
import { throttle } from "./throttle";
import { NonFunctionProperties } from "./types";

/**
 * @public
 */
export type CustomWorkloadMetrics = { [key: string]: number };

/**
 * @public
 */
export interface Workload<T extends object> {
    work: (module: Promisified<T>) => Promise<CustomWorkloadMetrics | void>;
    summarize?: (summaries: CustomWorkloadMetrics[]) => CustomWorkloadMetrics;
    format?: (key: string, value: number) => string;
    silent?: boolean;
}

function defaultFormat<K extends string>(key: K, value: number) {
    return `${key}:${f1(value)}`;
}

/** @public */
export class CostMetric {
    name!: string;
    pricing!: number;
    unit!: string;
    unitPlural?: string;
    measured!: number;
    comment?: string;
    informationalOnly?: boolean = false;

    /** @internal */
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

/**
 * @public
 */
export class CostSnapshot {
    constructor(
        readonly provider: string,
        readonly options: CommonOptions | AwsOptions | GoogleOptions,
        readonly stats: FunctionStats,
        readonly counters: FunctionCounters,
        readonly costMetrics: CostMetric[] = [],
        public repetitions: number = 1,
        public extraMetrics: CustomWorkloadMetrics = {}
    ) {}

    total() {
        return sum(this.costMetrics.map(metric => metric.cost()));
    }

    toString() {
        let rv = "";
        this.costMetrics.sort((a, b) => b.cost() - a.cost());
        const total = this.total();
        const comments = [];
        const percent = (entry: CostMetric) =>
            ((entry.cost() / total) * 100).toFixed(1).padStart(5) + "% ";
        for (const entry of this.costMetrics) {
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
        for (const entry of this.costMetrics) {
            rv += `${entry.name},${entry.unit},${p(entry.pricing)},${p(
                entry.measured
            )},${p(entry.cost())},${percent(entry)},"${(entry.comment || "").replace(
                '"',
                '""'
            )}"\n`;
        }
        return rv;
    }

    push(metric: CostMetric) {
        this.costMetrics.push(metric);
    }

    find(name: string) {
        return this.costMetrics.find(m => m.name === name);
    }
}

/**
 * @public
 */
export interface CostAnalyzerConfiguration {
    provider: "aws" | "google";
    repetitions: number;
    options: AwsOptions | GoogleOptions | CommonOptions;
    repetitionConcurrency: number;
}

/**
 * @public
 */
export const awsConfigurations: CostAnalyzerConfiguration[] = (() => {
    const rv: CostAnalyzerConfiguration[] = [];
    for (let memorySize = 128; memorySize <= 3008; memorySize += 64) {
        rv.push({
            provider: "aws",
            repetitions: 10,
            options: {
                mode: "queue",
                memorySize,
                timeout: 300,
                gc: false,
                childProcess: true
            },
            repetitionConcurrency: 10
        });
    }
    return rv;
})();

/**
 * @public
 */
export const googleConfigurations: CostAnalyzerConfiguration[] = (() => {
    const rv: CostAnalyzerConfiguration[] = [];
    for (let memorySize of [128, 256, 512, 1024, 2048]) {
        rv.push({
            provider: "google",
            repetitions: 10,
            options: {
                mode: "https",
                memorySize,
                timeout: 300,
                gc: false,
                childProcess: true
            },
            repetitionConcurrency: 10
        });
    }
    return rv;
})();

const ps = (n: number) => (n / 1000).toFixed(3);

function summarizeMean(extraMetrics: CustomWorkloadMetrics[]) {
    const stats: { [key: string]: Statistics } = {};
    extraMetrics.forEach(m =>
        keys(m).forEach(key => {
            if (!(key in stats)) {
                stats[key] = new Statistics();
            }
            stats[key].update(m[key]);
        })
    );
    const result = {} as CustomWorkloadMetrics;
    keys(stats).forEach(key => {
        result[key] = stats[key].mean;
    });
    return result;
}

async function estimate<T extends object>(
    mod: T,
    fmodule: string,
    workload: Workload<T>,
    config: CostAnalyzerConfiguration
): Promise<CostSnapshot> {
    const { provider, repetitions, options, repetitionConcurrency } = config;
    const cloudFunc = await faast(provider, mod, fmodule, options);
    const doWork = throttle({ concurrency: repetitionConcurrency }, workload.work);
    const results: Promise<CustomWorkloadMetrics | void>[] = [];
    for (let i = 0; i < repetitions; i++) {
        results.push(doWork(cloudFunc.functions).catch(_ => {}));
    }
    const rv = (await Promise.all(results)).filter(r => r) as CustomWorkloadMetrics[];
    await cloudFunc.cleanup();
    let summarize = workload.summarize || summarizeMean;
    const costEstimate = await cloudFunc.costEstimate();
    costEstimate.repetitions = repetitions;
    costEstimate.extraMetrics = summarize(rv);
    return costEstimate;
}

/**
 * @public
 */
export async function estimateWorkloadCost<T extends object>(
    mod: T,
    fmodule: string,
    configurations: CostAnalyzerConfiguration[] = awsConfigurations,
    workload: Workload<T>
) {
    const scheduleEstimate = throttle<
        [T, string, Workload<T>, CostAnalyzerConfiguration],
        CostSnapshot
    >(
        {
            concurrency: 8,
            rate: 4,
            burst: 1,
            retry: 3
        },
        estimate
    );

    const promises = configurations.map(config =>
        scheduleEstimate(mod, fmodule, workload, config)
    );

    const format = workload.format || defaultFormat;

    const renderer = workload.silent ? "silent" : "default";

    const list = new Listr(
        promises.map((promise, i) => {
            const { provider, repetitions, options } = configurations[i];
            const { memorySize, mode } = options;

            return {
                title: `${provider} ${memorySize}MB ${mode}`,
                task: async (_: any, task: Listr.ListrTaskWrapper) => {
                    const est = await promise;
                    const total = (est.total() / repetitions).toFixed(8);
                    const { errors } = est.counters;
                    const { executionTime } = est.stats;
                    const message = `${ps(executionTime.mean)}s ${ps(
                        executionTime.stdev
                    )}σ $${total}`;
                    const errMessage = errors > 0 ? ` (${errors} errors)` : "";
                    const extraMetrics = Object.keys(est.extraMetrics)
                        .map(k => format(k, est.extraMetrics[k]))
                        .join(" ");
                    task.title = `${task.title} ${message}${errMessage} ${extraMetrics}`;
                }
            };
        }),
        { concurrent: 8, nonTTYRenderer: renderer, renderer }
    );

    await list.run();
    const results = await Promise.all(promises);
    results.sort((a, b) => a.options.memorySize! - b.options.memorySize!);
    return results;
}

/**
 * @public
 */
export function toCSV(
    profile: Array<CostSnapshot>,
    format?: (key: string, value: number) => string
) {
    const allKeys = new Set<string>();
    profile.forEach(profile =>
        Object.keys(profile.extraMetrics).forEach(key => allKeys.add(key))
    );
    const columns = [
        "memory",
        "cloud",
        "mode",
        "options",
        "completed",
        "errors",
        "retries",
        "cost",
        "executionTime",
        "executionTimeStdev",
        "billedTime",
        ...allKeys
    ];
    let rv = columns.join(",") + "\n";

    const formatter = format || defaultFormat;
    profile.forEach(r => {
        const { memorySize, mode, ...rest } = r.options;
        const options = `"${inspect(rest).replace('"', '""')}"`;
        const { completed, errors, retries } = r.counters;
        const cost = (r.total() / r.repetitions).toFixed(8);

        const metrics: { [key in string]: string } = {};
        for (const key of allKeys) {
            metrics[key] = formatter(key, r.extraMetrics[key]);
        }

        const row = {
            memory: memorySize,
            cloud: r.provider,
            mode: mode,
            options: options,
            completed,
            errors,
            retries,
            cost: `$${cost}`,
            executionTime: ps(r.stats.executionTime.mean),
            executionTimeStdev: ps(r.stats.executionTime.stdev),
            billedTime: ps(r.stats.estimatedBilledTime.mean),
            ...metrics
        };

        rv += keys(row)
            .map(k => String(row[k]))
            .join(",");
        rv += "\n";
    });
    return rv;
}
