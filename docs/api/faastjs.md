[Home](./index) &gt; [faastjs](./faastjs.md)

## faastjs package

## Classes

|  Class | Description |
|  --- | --- |
|  [CostAnalyzerResult](./faastjs.costanalyzerresult.md) | Cost analyzer results for each workload and configuration.<!-- -->The `estimates` property has the cost estimates for each configuration. See [CostAnalyzerConfigurationEstimate](./faastjs.costanalyzerconfigurationestimate.md)<!-- -->. |
|  [CostMetric](./faastjs.costmetric.md) | A line item in the cost estimate, including the resource usage metric measured and its pricing. |
|  [CostSnapshot](./faastjs.costsnapshot.md) | A summary of the costs incurred by a faast.js module at a point in time. Output of [FaastModule.costSnapshot()](./faastjs.faastmodule.costsnapshot.md)<!-- -->. |
|  [FaastError](./faastjs.faasterror.md) | Error type returned by cloud functions when they reject their promises with an instance of Error or any object. |
|  [FaastModuleProxy](./faastjs.faastmoduleproxy.md) | Implementation of the faast.js runtime. |
|  [FunctionStats](./faastjs.functionstats.md) | Summary statistics for function invocations. |
|  [FunctionStatsEvent](./faastjs.functionstatsevent.md) | Summarize statistics about cloud function invocations. |
|  [PersistentCache](./faastjs.persistentcache.md) | A simple persistent key-value store. Entries can be expired, but are not actually deleted individually. The entire cache can be deleted at once. Hence this cache is useful for storing results that are expensive to compute but do not change too often (e.g. the node\_modules folder from an 'npm install' where 'package.json' is not expected to change too often).<!-- -->This is used to implement [Limits.cache](./faastjs.limits.cache.md) for the [throttle()](./faastjs.throttle.md) function. |
|  [Statistics](./faastjs.statistics.md) | Incrementally updated statistics on a set of values. |

## Functions

|  Function | Description |
|  --- | --- |
|  [costAnalyzer(mod, fmodule, userWorkload, configurations)](./faastjs.costanalyzer.md) | Estimate the cost of a workload using multiple configurations and providers. |
|  [faast(provider, fmodule, modulePath, options)](./faastjs.faast.md) | The main entry point for faast with any provider and only common options. |
|  [faastAws(fmodule, modulePath, options)](./faastjs.faastaws.md) | The main entry point for faast with AWS provider. |
|  [faastGoogle(fmodule, modulePath, options)](./faastjs.faastgoogle.md) | The main entry point for faast with Google provider. |
|  [faastLocal(fmodule, modulePath, options)](./faastjs.faastlocal.md) | The main entry point for faast with Local provider. |
|  [throttle({ concurrency, retry, rate, burst, memoize, cache }, fn)](./faastjs.throttle.md) | A decorator for rate limiting, concurrency limiting, retry, memoization, and on-disk caching. |

## Interfaces

|  Interface | Description |
|  --- | --- |
|  [AwsOptions](./faastjs.awsoptions.md) | AWS-specific options. Extends [CommonOptions](./faastjs.commonoptions.md)<!-- -->. These options should be used with [faastAws()](./faastjs.faastaws.md)<!-- -->. |
|  [CleanupOptions](./faastjs.cleanupoptions.md) | Options that apply to the [FaastModule.cleanup()](./faastjs.faastmodule.cleanup.md) method. |
|  [CommonOptions](./faastjs.commonoptions.md) | Options common across all faast.js providers. |
|  [CostAnalyzerConfigurationEstimate](./faastjs.costanalyzerconfigurationestimate.md) | A cost estimate result for a specific cost analyzer configuration. |
|  [CostAnalyzerWorkload](./faastjs.costanalyzerworkload.md) | A user-defined cost analyzer workload for [costAnalyzer()](./faastjs.costanalyzer.md)<!-- -->.<!-- -->Example: |
|  [FaastModule](./faastjs.faastmodule.md) | The main interface for invoking, cleaning up, and managing faast.js cloud functions. |
|  [GoogleOptions](./faastjs.googleoptions.md) | Google-specific options. Extends [CommonOptions](./faastjs.commonoptions.md)<!-- -->. To be used with [faastGoogle()](./faastjs.faastgoogle.md)<!-- -->. |
|  [Limits](./faastjs.limits.md) | Specify throttle limits. These limits shape the way throttle invokes the underlying function. |
|  [LocalOptions](./faastjs.localoptions.md) | Local provider options. Extends [CommonOptions](./faastjs.commonoptions.md)<!-- -->. To be used with [faastLocal()](./faastjs.faastlocal.md)<!-- -->. |

## Variables

|  Variable | Description |
|  --- | --- |
|  [awsConfigurations](./faastjs.awsconfigurations.md) | Default AWS cost analyzer configurations include all memory sizes for AWS Lambda. |
|  [googleConfigurations](./faastjs.googleconfigurations.md) | Default Google Cloud Functions cost analyzer configurations include all available memory sizes. |
|  [log](./faastjs.log.md) | Faast.js loggers. |
|  [providers](./faastjs.providers.md) |  |

## Type Aliases

|  Type Alias | Description |
|  --- | --- |
|  [AwsFaastModule](./faastjs.awsfaastmodule.md) | The return type of [faastAws()](./faastjs.faastaws.md)<!-- -->. See [FaastModuleProxy](./faastjs.faastmoduleproxy.md)<!-- -->. |
|  [AwsRegion](./faastjs.awsregion.md) | Valid AWS [regions](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-regions-availability-zones.html)<!-- -->. Not all of these regions have Lambda support. |
|  [CostAnalyzerConfiguration](./faastjs.costanalyzerconfiguration.md) | An input to [costAnalyzer()](./faastjs.costanalyzer.md)<!-- -->, specifying one configuration of faast.js to run against a workload. See [AwsOptions](./faastjs.awsoptions.md) and [GoogleOptions](./faastjs.googleoptions.md)<!-- -->. |
|  [GoogleFaastModule](./faastjs.googlefaastmodule.md) | The return type of [faastGoogle()](./faastjs.faastgoogle.md)<!-- -->. See [FaastModuleProxy](./faastjs.faastmoduleproxy.md)<!-- -->. |
|  [LocalFaastModule](./faastjs.localfaastmodule.md) | The return type of [faastLocal()](./faastjs.faastlocal.md)<!-- -->. See [FaastModuleProxy](./faastjs.faastmoduleproxy.md)<!-- -->. |
|  [Promisified](./faastjs.promisified.md) | Promisified<M> is the type of [FaastModule.functions](./faastjs.faastmodule.functions.md)<!-- -->. It maps an imported module's functions to promise-returning versions of those functions (see [PromisifiedFunction](./faastjs.promisifiedfunction.md)<!-- -->). Non-function exports of the module are omitted. |
|  [PromisifiedFunction](./faastjs.promisifiedfunction.md) | Given argument types A and return type R of a function, PromisifiedFunction<!-- -->&lt;<!-- -->A,R<!-- -->&gt; is a type with the same signature except the return value is replaced with a Promise. If the original function already returned a promise, the signature is unchanged. This is used by [Promisified](./faastjs.promisified.md)<!-- -->. |
|  [Provider](./faastjs.provider.md) | The type of all supported cloud providers. |
|  [Unpacked](./faastjs.unpacked.md) |  |
|  [WorkloadAttribute](./faastjs.workloadattribute.md) | User-defined custom metrics for a workload. These are automatically summarized in the output; see [CostAnalyzerWorkload](./faastjs.costanalyzerworkload.md)<!-- -->. |

