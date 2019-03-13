import * as Listr from "listr";
import { inspect } from "util";
import { faast, FaastModule } from "../index";
import { AwsOptions } from "./aws/aws-faast";
import { GoogleOptions } from "./google/google-faast";
import { FunctionStats, CommonOptions } from "./provider";
import { f1, keys, Statistics, sum } from "./shared";
import { throttle } from "./throttle";
import { PropertiesExcept, AnyFunction } from "./types";

/**
 * User-defined custom metrics for a workload. These are automatically
 * summarized in the output; see {@link Workload}.
 * @public
 */
export type WorkloadAttribute<A extends string> = { [attr in A]: number };

/**
 * A user-defined cost analyzer workload. This workload is input to
 * {@link estimateWorkloadCost}.
 * @public
 */
export interface Workload<T extends object, A extends string> {
    work: (faastModule: FaastModule<T>) => Promise<WorkloadAttribute<A> | void>;
    summarize?: (summaries: WorkloadAttribute<A>[]) => WorkloadAttribute<A>;
    format?: (attr: A, value: number) => string;
    formatCSV?: (attr: A, value: number) => string;
    silent?: boolean;
}

function defaultFormat(attr: string, value: number) {
    return `${attr}:${f1(value)}`;
}

function defaultFormatCSV(_: string, value: number) {
    return f1(value);
}

/**
 * A line item in the cost estimate, including the resource usage metric
 * measured and its pricing.
 * @public
 */
export class CostMetric {
    readonly name: string;
    readonly pricing: number;
    readonly unit: string;
    readonly measured: number;
    readonly unitPlural?: string;
    readonly comment?: string;
    readonly informationalOnly?: boolean;

    /** @internal */
    constructor(arg: PropertiesExcept<CostMetric, AnyFunction>) {
        this.name = arg.name;
        this.pricing = arg.pricing;
        this.unit = arg.unit;
        this.measured = arg.measured;
        this.unitPlural = arg.unitPlural;
        this.comment = arg.comment;
        this.informationalOnly = arg.informationalOnly;
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
    readonly stats: FunctionStats;
    readonly costMetrics: CostMetric[] = [];
    constructor(
        readonly provider: string,
        readonly options: CommonOptions | AwsOptions | GoogleOptions,
        stats: FunctionStats,
        costMetrics: CostMetric[] = []
    ) {
        this.stats = stats.clone();
        this.costMetrics = [...costMetrics];
    }

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
export type CostAnalyzerConfiguration =
    | {
          provider: "aws";
          options: AwsOptions;
      }
    | {
          provider: "google";
          options: GoogleOptions;
      };

/**
 * @public
 */
export const awsConfigurations: CostAnalyzerConfiguration[] = (() => {
    const rv: CostAnalyzerConfiguration[] = [];
    for (let memorySize = 128; memorySize <= 3008; memorySize += 64) {
        rv.push({
            provider: "aws",
            options: {
                mode: "queue",
                memorySize,
                timeout: 300,
                gc: false,
                childProcess: true
            }
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
            options: {
                mode: "https",
                memorySize,
                timeout: 300,
                gc: false,
                childProcess: true
            }
        });
    }
    return rv;
})();

const ps = (n: number) => (n / 1000).toFixed(3);

function summarizeMean<A extends string>(attributes: WorkloadAttribute<A>[]) {
    const stats: { [attr: string]: Statistics } = {};
    attributes.forEach(a =>
        keys(a).forEach(attr => {
            if (!(attr in stats)) {
                stats[attr] = new Statistics();
            }
            stats[attr].update(a[attr]);
        })
    );
    const result = {} as any;
    keys(stats).forEach(attr => {
        result[attr] = stats[attr].mean;
    });
    return result;
}

interface Estimate<A extends string> {
    costSnapshot: CostSnapshot;
    config: CostAnalyzerConfiguration;
    extraMetrics: WorkloadAttribute<A>;
    repetitions: number;
}

async function estimate<T extends object, K extends string>(
    mod: T,
    fmodule: string,
    workload: Workload<T, K>,
    config: CostAnalyzerConfiguration,
    repetitions: number,
    repetitionConcurrency: number
): Promise<Estimate<K>> {
    const { provider, options } = config;
    const faastModule = await faast(provider, mod, fmodule, options);
    const doWork = throttle({ concurrency: repetitionConcurrency }, workload.work);
    const results: Promise<WorkloadAttribute<K> | void>[] = [];
    for (let i = 0; i < repetitions; i++) {
        results.push(doWork(faastModule).catch(_ => {}));
    }
    const rv = (await Promise.all(results)).filter(r => r) as WorkloadAttribute<K>[];
    await faastModule.cleanup();
    let summarize = workload.summarize || summarizeMean;
    const costSnapshot = await faastModule.costSnapshot();
    const extraMetrics = summarize(rv);
    return { costSnapshot, config, extraMetrics, repetitions };
}

/**
 * @public
 */
export async function estimateWorkloadCost<T extends object, A extends string>(
    mod: T,
    fmodule: string,
    configurations: CostAnalyzerConfiguration[] = awsConfigurations,
    workload: Workload<T, A>,
    repetitions: number = 10,
    repetitionConcurrency: number = 10
) {
    const scheduleEstimate = throttle<
        [T, string, Workload<T, A>, CostAnalyzerConfiguration, number, number],
        Estimate<A>
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
        scheduleEstimate(
            mod,
            fmodule,
            workload,
            config,
            repetitions,
            repetitionConcurrency
        )
    );

    const format = workload.format || defaultFormat;

    const renderer = workload.silent ? "silent" : "default";

    const list = new Listr(
        promises.map((promise, i) => {
            const { provider, options } = configurations[i];
            const { memorySize, mode } = options;

            return {
                title: `${provider} ${memorySize}MB ${mode}`,
                task: async (_: any, task: Listr.ListrTaskWrapper) => {
                    const { costSnapshot, extraMetrics } = await promise;
                    const total = (costSnapshot.total() / repetitions).toFixed(8);
                    const { errors } = costSnapshot.stats;
                    const { executionTime } = costSnapshot.stats;
                    const message = `${ps(executionTime.mean)}s ${ps(
                        executionTime.stdev
                    )}σ $${total}`;
                    const errMessage = errors > 0 ? ` (${errors} errors)` : "";
                    const extra = keys(extraMetrics)
                        .map(k => format(k, extraMetrics[k]))
                        .join(" ");
                    task.title = `${task.title} ${message}${errMessage} ${extra}`;
                }
            };
        }),
        { concurrent: 8, nonTTYRenderer: renderer, renderer }
    );

    await list.run();
    const results = await Promise.all(promises);
    results.sort(
        (a, b) => a.costSnapshot.options.memorySize! - b.costSnapshot.options.memorySize!
    );
    return new WorkloadCostAnalyzerResult(workload, results, repetitions);
}

/**
 * @public
 */
export class WorkloadCostAnalyzerResult<T extends object, A extends string> {
    /** @internal */
    constructor(
        readonly workload: Workload<T, A>,
        readonly estimates: Estimate<A>[],
        readonly repetitions: number
    ) {}

    csv() {
        const attributes = new Set<A>();
        this.estimates.forEach(est =>
            keys(est.extraMetrics).forEach(key => attributes.add(key))
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
            ...attributes
        ];
        let rv = columns.join(",") + "\n";

        this.estimates.forEach(({ costSnapshot, extraMetrics }) => {
            const { memorySize, mode, ...rest } = costSnapshot.options;
            const options = `"${inspect(rest).replace('"', '""')}"`;
            const {
                completed,
                errors,
                retries,
                executionTime,
                estimatedBilledTime
            } = costSnapshot.stats;
            const cost = (costSnapshot.total() / this.repetitions).toFixed(8);
            const formatter = this.workload.formatCSV || defaultFormatCSV;

            const metrics: { [attr in string]: string } = {};
            for (const attr of attributes) {
                metrics[attr] = formatter(attr, extraMetrics[attr]);
            }
            const row = {
                memory: memorySize,
                cloud: costSnapshot.provider,
                mode: mode,
                options: options,
                completed,
                errors,
                retries,
                cost: `$${cost}`,
                executionTime: ps(executionTime.mean),
                executionTimeStdev: ps(executionTime.stdev),
                billedTime: ps(estimatedBilledTime.mean),
                ...metrics
            };

            rv += keys(row)
                .map(k => String(row[k]))
                .join(",");
            rv += "\n";
        });
        return rv;
    }
}
