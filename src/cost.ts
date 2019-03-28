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
 * A line item in the cost estimate, including the resource usage metric
 * measured and its pricing.
 * @public
 */
export class CostMetric {
    /** The name of the cost metric, e.g. `functionCallDuration` */
    readonly name: string;
    /** The price in USD per unit measured. */
    readonly pricing: number;
    /** The name of the units that pricing is measured in for this metric. */
    readonly unit: string;
    /** The measured value of the cost metric, in units. */
    readonly measured: number;
    /**
     * The plural form of the unit name. By default the plural form will be the
     * name of the unit with "s" appended at the end, unless the last letter is
     * capitalized, in which case there is no plural form (e.g. "GB").
     */
    readonly unitPlural?: string;
    /**
     * An optional comment, usually providing a link to the provider's pricing
     * page and other data.
     */
    readonly comment?: string;
    /**
     * True if this cost metric is only for informational purposes (e.g. AWS's
     * `logIngestion`) and does not contribute cost.
     */
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

    /**
     * The cost contribution of this cost metric. Equal to
     * {@link CostMetric.pricing} * {@link CostMetric.measured}.
     */
    cost() {
        return this.pricing * this.measured;
    }

    /**
     * Return a string with the cost estimate for this metric, omitting
     * comments.
     */
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

    /** Describe this cost metric, including comments. */
    toString() {
        return `${this.describeCostOnly()}${(this.comment && `// ${this.comment}`) ||
            ""}`;
    }
}

/**
 * A summary of the costs incurred by a faast.js module at a point in time.
 * Output of {@link FaastModule.costSnapshot}.
 * @remarks
 * Cost information provided by faast.js is an estimate. It is derived from
 * internal faast.js measurements and not by consulting data provided by your
 * cloud provider.
 *
 * **Faast.js does not guarantee the accuracy of cost estimates.**
 *
 * **Use at your own risk.**
 *
 * Example using AWS:
 * ```typescript
 * const faastModule = await faast("aws", m, "./functions");
 * try {
 *     // Invoke faastModule.functions.*
 * } finally {
 *     await faastModule.cleanup();
 *     console.log(`Cost estimate:`);
 *     console.log(`${await faastModule.costSnapshot()}`);
 * }
 * ```
 *
 * AWS example output:
 * ```
 * Cost estimate:
 * functionCallDuration  $0.00002813/second            0.6 second     $0.00001688    68.4%  [1]
 * sqs                   $0.00000040/request             9 requests   $0.00000360    14.6%  [2]
 * sns                   $0.00000050/request             5 requests   $0.00000250    10.1%  [3]
 * functionCallRequests  $0.00000020/request             5 requests   $0.00000100     4.1%  [4]
 * outboundDataTransfer  $0.09000000/GB         0.00000769 GB         $0.00000069     2.8%  [5]
 * logIngestion          $0.50000000/GB                  0 GB         $0              0.0%  [6]
 * ---------------------------------------------------------------------------------------
 *                                                                    $0.00002467 (USD)
 *
 *   * Estimated using highest pricing tier for each service. Limitations apply.
 *  ** Does not account for free tier.
 * [1]: https://aws.amazon.com/lambda/pricing (rate = 0.00001667/(GB*second) * 1.6875 GB = 0.00002813/second)
 * [2]: https://aws.amazon.com/sqs/pricing
 * [3]: https://aws.amazon.com/sns/pricing
 * [4]: https://aws.amazon.com/lambda/pricing
 * [5]: https://aws.amazon.com/ec2/pricing/on-demand/#Data_Transfer
 * [6]: https://aws.amazon.com/cloudwatch/pricing/ - Log ingestion costs not currently included.
 * ```
 *
 * A cost snapshot contains several {@link CostMetric} values. Each `CostMetric`
 * summarizes one component of the overall cost of executing the functions so
 * far. Some cost metrics are common to all faast providers, and other metrics
 * are provider-specific. The common metrics are:
 *
 * - `functionCallDuration`: the estimated billed CPU time (rounded to the next
 *   100ms) consumed by completed cloud function calls. This is the metric that
 *   usually dominates cost.
 *
 * - `functionCallRequests`: the number of invocation requests made. Most
 *   providers charge for each invocation.
 *
 * Provider-specific metrics vary. For example, AWS has the following additional
 * metrics:
 *
 * - `sqs`: AWS Simple Queueing Service. This metric captures the number of
 *   queue requests made to insert and retrieve queued results (each 64kb chunk
 *   is counted as an additional request). SQS is used even if
 *   {@link CommonOptions.mode} is not set to `"queue"`, because it is necessary
 *   for monitoring cloud function invocations.
 *
 * - `sns`: AWS Simple Notification Service. SNS is used to invoke Lambda
 *   functions when {@link CommonOptions.mode} is `"queue"`.
 *
 * - `outboundDataTransfer`: an estimate of the network data transferred out
 *   from the cloud provider for this faast.js module. This estimate only counts
 *   data returned from cloud function invocations and infrastructure that
 *   faast.js sets up. It does not count any outbound data sent by your cloud
 *   functions that are not known to faast.js. Note that if you run faast.js on
 *   EC2 in the same region (see {@link AwsOptions.region}), then the data
 *   transfer costs will be zero (however, the cost snapshot will not include
 *   EC2 costs). Also note that if your cloud function transfers data from/to S3
 *   buckets in the same region, there is no cost as long as that data is not
 *   returned from the function.
 *
 * - `logIngestion`: this cost metric is always zero for AWS. It is present to
 *   remind the user that AWS charges for log data ingested by CloudWatch Logs
 *   that are not measured by faast.js. Log entries may arrive significantly
 *   after function execution completes, and there is no way for faast.js to
 *   know exactly how long to wait, therefore it does not attempt to measure
 *   this cost. In practice, if your cloud functions do not perform extensive
 *   logging on all invocations, log ingestion costs from faast.js are likely to
 *   be low or fall within the free tier.
 *
 * For Google, extra metrics include `outboundDataTransfer` similar to AWS, and
 * `pubsub`, which combines costs that are split into `sns` and `sqs` on AWS.
 *
 * The Local provider has no extra metrics.
 *
 * Prices are retrieved dynamically from AWS and Google and cached locally.
 * Cached prices expire after 24h. For each cost metric, faast.js uses the
 * highest price tier to compute estimated pricing.
 *
 * Cost estimates do not take free tiers into account.
 * @public
 */
export class CostSnapshot {
    /** The function statistics that were used to compute prices. */
    readonly stats: FunctionStats;
    /**
     * The cost metric components for this cost snapshot. See
     * {@link CostMetric}.
     */
    readonly costMetrics: CostMetric[] = [];
    /** @internal */
    constructor(
        readonly provider: string,
        /** The options used to initialize the faast.js module where this cost
         * snapshot was generated. */
        readonly options: CommonOptions | AwsOptions | GoogleOptions,
        stats: FunctionStats,
        costMetrics: CostMetric[] = []
    ) {
        this.stats = stats.clone();
        this.costMetrics = [...costMetrics];
    }

    /** Sum of cost metrics. */
    total() {
        return sum(this.costMetrics.map(metric => metric.cost()));
    }

    /** A summary of all cost metrics and prices in this cost snapshot. */
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

    /**
     * Comma separated value output for a cost snapshot.
     * @remarks
     * The format is "metric,unit,pricing,measured,cost,percentage,comment".
     *
     * Example output:
     * ```
     * metric,unit,pricing,measured,cost,percentage,comment
     * functionCallDuration,second,0.00002813,0.60000000,0.00001688,64.1% ,"https://aws.amazon.com/lambda/pricing (rate = 0.00001667/(GB*second) * 1.6875 GB = 0.00002813/second)"
     * functionCallRequests,request,0.00000020,5,0.00000100,3.8% ,"https://aws.amazon.com/lambda/pricing"
     * outboundDataTransfer,GB,0.09000000,0.00000844,0.00000076,2.9% ,"https://aws.amazon.com/ec2/pricing/on-demand/#Data_Transfer"
     * sqs,request,0.00000040,13,0.00000520,19.7% ,"https://aws.amazon.com/sqs/pricing"
     * sns,request,0.00000050,5,0.00000250,9.5% ,"https://aws.amazon.com/sns/pricing"
     * logIngestion,GB,0.50000000,0,0,0.0% ,"https://aws.amazon.com/cloudwatch/pricing/ - Log ingestion costs not currently included."
     * ```
     */
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

    /** @internal */
    push(metric: CostMetric) {
        this.costMetrics.push(metric);
    }

    /*
     * Find a specific cost metric by name.
     * @returns a {@link CostMetric} if found, otherwise `undefined`.
     */
    find(name: string) {
        return this.costMetrics.find(m => m.name === name);
    }
}

/**
 * Analyze the cost of a workload across many provider configurations.
 * @public
 */
export namespace CostAnalyzer {
    /**
     * User-defined custom metrics for a workload. These are automatically
     * summarized in the output; see {@link CostAnalyzer.Workload}.
     * @public
     */
    export type WorkloadAttribute<A extends string> = { [attr in A]: number };

    /**
     * A user-defined cost analyzer workload for {@link CostAnalyzer.analyze}.
     * @public
     * Example:
     */
    export interface Workload<T extends object, A extends string> {
        /**
         * A function that executes cloud functions on
         * `faastModule.functions.*`. The work function should return `void` if
         * there are no custom workload attributes. Otherwise, it should return
         * a {@link CostAnalyzer.WorkloadAttribute} object which maps
         * user-defined attribute names to numerical values for the workload.
         * For example, this might measure bandwidth or some other metric not
         * tracked by faast.js, but are relevant for evaluating the
         * cost-performance tradeoff of the configurations analyzed by the cost
         * analyzer.
         */
        work: (faastModule: FaastModule<T>) => Promise<WorkloadAttribute<A> | void>;
        /**
         * Combine {@link CostAnalyzer.WorkloadAttribute} instances returned
         * from multiple workload executions (caused by value of
         * {@link CostAnalyzer.Workload.repetitions}). The default is a function
         * that takes the average of each attribute.
         */
        summarize?: (summaries: WorkloadAttribute<A>[]) => WorkloadAttribute<A>;
        /**
         * Format an attribute value for console output. This is displayed by
         * the cost analyzer when all of the repetitions for a configuration
         * have completed. The default returns
         * `${attribute}:${value.toFixed(1)}`.
         */
        format?: (attr: A, value: number) => string;
        /**
         * Format an attribute value for CSV. The default returns
         * `value.toFixed(1)`.
         */
        formatCSV?: (attr: A, value: number) => string;
        /**
         * If true, do not output live results to the console. Can be useful for
         * running the cost analyzer as part of automated tests. Default: false.
         */
        silent?: boolean;
        /**
         * The number of repetitions to run the workload for each cost analyzer
         * configuration. Higher repetitions help reduce the jitter in the
         * results. Repetitions execute in the same FaastModule instance.
         * Default: 10.
         */
        repetitions?: number;
        /**
         * The amount of concurrency to allow. Concurrency can arise from
         * multiple repetitions of the same configuration, or concurrenct
         * executions of different configurations. This concurrency limit
         * throttles the total number of concurrent workload executions across
         * both of these sources of concurrency. Default: 64.
         */
        concurrency?: number;
    }

    const workloadDefaults = {
        summarize: summarizeMean,
        format: defaultFormat,
        formatCSV: defaultFormatCSV,
        silent: false,
        repetitions: 10,
        concurrency: 64
    };

    function defaultFormat(attr: string, value: number) {
        return `${attr}:${f1(value)}`;
    }

    function defaultFormatCSV(_: string, value: number) {
        return f1(value);
    }

    /**
     * An input to {@link CostAnalyzer.analyze}, specifying one
     * configuration of faast.js to run against a workload. See
     * {@link AwsOptions} and {@link GoogleOptions}.
     * @public
     */
    export type Configuration =
        | {
              provider: "aws";
              options: AwsOptions;
          }
        | {
              provider: "google";
              options: GoogleOptions;
          };

    /**
     * Default AWS cost analyzer configurations include all memory sizes for AWS
     * Lambda.
     * @remarks
     * The default AWS cost analyzer configurations include every memory size
     * from 128MB to 3008MB in 64MB increments. Each configuration has the
     * following settings:
     *
     * ```typescript
     * {
     *     provider: "aws",
     *     options: {
     *         mode: "https",
     *         memorySize,
     *         timeout: 300,
     *         gc: false,
     *         childProcess: true
     *     }
     * }
     * ```
     *
     * Use `Array.map` to change or `Array.filter` to remove some of these
     * configurations. For example:
     *
     * ```typescript
     * const configsWithAtLeast1GB = awsConfigurations.filter(c => c.memorySize > 1024)
     * const shorterTimeout = awsConfigurations.map(c => ({...c, timeout: 60 }));
     * ```
     * @public
     */
    export const awsConfigurations: Configuration[] = (() => {
        const rv: Configuration[] = [];
        for (let memorySize = 128; memorySize <= 3008; memorySize += 64) {
            rv.push({
                provider: "aws",
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

    /**
     * Default Google Cloud Functions cost analyzer configurations include all
     * available memory sizes.
     * @remarks
     * Each google cost analyzer configuration follows this template:
     *
     * ```typescript
     * {
     *     provider: "google",
     *     options: {
     *         mode: "https",
     *         memorySize,
     *         timeout: 300,
     *         gc: false,
     *         childProcess: true
     *     }
     * }
     * ```
     *
     * where `memorySize` is in `[128, 256, 512, 1024, 2048]`.
     * @public
     */
    export const googleConfigurations: Configuration[] = (() => {
        const rv: Configuration[] = [];
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

    /**
     * A cost estimate result for a specific cost analyzer configuration.
     * @public
     */
    export interface Estimate<A extends string> {
        /**
         * The cost snapshot for the cost analysis of the specific (workload,
         * configuration) combination. See {@link CostSnapshot}.
         */
        costSnapshot: CostSnapshot;
        /**
         * The worload configuration that was analyzed. See
         * {@link CostAnalyzer.Configuration}.
         */
        config: Configuration;
        /**
         * Additional workload metrics returned from the work function. See
         * {@link CostAnalyzer.WorkloadAttribute}.
         */
        extraMetrics: WorkloadAttribute<A>;
    }

    async function estimate<T extends object, K extends string>(
        mod: T,
        fmodule: string,
        workload: Required<Workload<T, K>>,
        config: Configuration
    ): Promise<Estimate<K>> {
        const { provider, options } = config;
        const faastModule = await faast(provider, mod, fmodule, options);
        const { repetitions, concurrency: repetitionConcurrency } = workload;
        const doWork = throttle({ concurrency: repetitionConcurrency }, workload.work);
        const results: Promise<WorkloadAttribute<K> | void>[] = [];
        for (let i = 0; i < repetitions; i++) {
            results.push(doWork(faastModule).catch(_ => {}));
        }
        const rv = (await Promise.all(results)).filter(r => r) as WorkloadAttribute<K>[];
        await faastModule.cleanup();
        const costSnapshot = await faastModule.costSnapshot();
        const extraMetrics = workload.summarize(rv);
        return { costSnapshot, config, extraMetrics };
    }

    /**
     * Estimate the cost of a workload using multiple configurations and
     * providers.
     * @remarks
     * It can be deceptively difficult to set optimal parameters for AWS Lambda
     * and similar services. On the surface there appears to be only one
     * parameter: memory size. Choosing more memory also gives more CPU
     * performance, but it's unclear how much. It's also unclear where single
     * core performance stops getting better. The workload cost analyzer solves
     * these problems by making it easy to run cost experiments.
     * ```
     *                                                      (AWS)
     *                                                    ┌───────┐
     *                                              ┌────▶│ 128MB │
     *                                              │     └───────┘
     *                                              │     ┌───────┐
     *                      ┌─────────────────┐     ├────▶│ 256MB │
     *  ┌──────────────┐    │                 │     │     └───────┘
     *  │   workload   │───▶│                 │     │        ...
     *  └──────────────┘    │                 │     │     ┌───────┐
     *                      │  cost analyzer  │─────┼────▶│3008MB │
     *  ┌──────────────┐    │                 │     │     └───────┘
     *  │configurations│───▶│                 │     │
     *  └──────────────┘    │                 │     │     (Google)
     *                      └─────────────────┘     │     ┌───────┐
     *                                              ├────▶│ 128MB │
     *                                              │     └───────┘
     *                                              │     ┌───────┐
     *                                              └────▶│ 256MB │
     *                                                    └───────┘
     * ```
     * `costAnalyzer` is the entry point. It automatically runs this workload
     * against multiple configurations in parallel. Then it uses faast.js' cost
     * snapshot mechanism to automatically determine the price of running the
     * workload with each configuration.
     *
     * Example:
     *
     * ```typescript
     * // functions.ts
     * export function randomNumbers(n: number) {
     *     let sum = 0;
     *     for (let i = 0; i < n; i++) {
     *         sum += Math.random();
     *     }
     *     return sum;
     * }
     *
     * // cost-analyzer-example.ts
     * import { writeFileSync } from "fs";
     * import { costAnalyzer, FaastModule } from "faastjs";
     * import * as mod from "./functions";
     *
     * async function work(faastModule: FaastModule<typeof mod>) {
     *     await faastModule.functions.randomNumbers(100000000);
     * }
     *
     * async function main() {
     *     const results = await costAnalyzer(mod, "./functions", { work });
     *     writeFileSync("cost.csv", results.csv());
     * }
     *
     * main();
     * ```
     *
     * Example output (this is printed to `console.log` unless the
     * {@link CostAnalyzer.Workload.silent} is `true`):
     * ```
     *   ✔ aws 128MB queue 15.385s 0.274σ $0.00003921
     *   ✔ aws 192MB queue 10.024s 0.230σ $0.00003576
     *   ✔ aws 256MB queue 8.077s 0.204σ $0.00003779
     *      ▲    ▲     ▲     ▲       ▲        ▲
     *      │    │     │     │       │        │
     *  provider │    mode   │     stdev     average
     *           │           │   execution  estimated
     *         memory        │     time       cost
     *          size         │
     *                 average cloud
     *                 execution time
     * ```
     *
     * The output lists the provider, memory size, ({@link CommonOptions.mode}),
     * average time of a single execution of the workload, the standard
     * deviation (in seconds) of the execution time, and average estimated cost
     * for a single run of the workload.
     *
     * The "execution time" referenced here is not wall clock time, but rather
     * execution time in the cloud function. The execution time does not include
     * any time the workload spends waiting locally. If the workload invokes
     * multiple cloud functions, their execution times will be summed even if
     * they happen concurrently. This ensures the execution time and cost are
     * aligned.
     *
     * @param mod - The module containing the remote cloud functions to analyze.
     * @param fmodule - Path to the module `mod`. This can be either an absolute
     * filename (e.g. from `require.resolve`) or a path omitting the `.js`
     * extension as would be use with `require` or `import`.
     * @param userWorkload - a {@link CostAnalyzer.Workload} object
     * specifying the workload to run and additional parameters.
     * @param configurations - an array specifying
     * {@link CostAnalyzer.Configuration}s to run. Default:
     * {@link CostAnalyzer.awsConfigurations}.
     * @returns A promise for a {@link CostAnalyzer.Result}
     * @public
     */
    export async function analyze<T extends object, A extends string>(
        mod: T,
        fmodule: string,
        userWorkload: Workload<T, A>,
        configurations: Configuration[] = awsConfigurations
    ) {
        const scheduleEstimate = throttle<
            [T, string, Required<Workload<T, A>>, Configuration],
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

        const { concurrency = workloadDefaults.concurrency } = userWorkload;
        const workload = Object.assign({}, workloadDefaults, userWorkload, {
            work: throttle({ concurrency }, userWorkload.work)
        });

        const promises = configurations.map(config =>
            scheduleEstimate(mod, fmodule, workload, config)
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
                        const total = (
                            costSnapshot.total() / workload.repetitions
                        ).toFixed(8);
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
            (a, b) =>
                a.costSnapshot.options.memorySize! - b.costSnapshot.options.memorySize!
        );
        return new Result(workload, results);
    }

    /**
     * Cost analyzer results for each workload and configuration.
     * @remarks
     * The `estimates` property has the cost estimates for each configuration.
     * See {@link CostAnalyzer.Estimate}.
     * @public
     */
    export class Result<T extends object, A extends string> {
        /** @internal */
        constructor(
            /** The workload analyzed. */
            readonly workload: Required<Workload<T, A>>,
            /**
             * Cost estimates for each configuration of the workload. See
             * {@link CostAnalyzer.Estimate}.
             */
            readonly estimates: Estimate<A>[]
        ) {}

        /**
         * Comma-separated output of cost analyzer. One line per cost analyzer
         * configuration.
         * @remarks
         * The columns are:
         *
         * - `memory`: The memory size allocated.
         *
         * - `cloud`: The cloud provider.
         *
         * - `mode`: See {@link CommonOptions.mode}.
         *
         * - `options`: A string summarizing other faast.js options applied to the
         *   `workload`. See {@link CommonOptions}.
         *
         * - `completed`: Number of repetitions that successfully completed.
         *
         * - `errors`: Number of invocations that failed.
         *
         * - `retries`: Number of retries that were attempted.
         *
         * - `cost`: The average cost of executing the workload once.
         *
         * - `executionTime`: the aggregate time spent executing on the provider for
         *   all cloud function invocations in the workload. This is averaged across
         *   repetitions.
         *
         * - `executionTimeStdev`: The standard deviation of `executionTime`.
         *
         * - `billedTime`: the same as `exectionTime`, except rounded up to the next
         *   100ms for each invocation. Usually very close to `executionTime`.
         */
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
                const cost = (costSnapshot.total() / this.workload.repetitions).toFixed(
                    8
                );
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
}
