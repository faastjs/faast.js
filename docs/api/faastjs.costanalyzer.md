[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CostAnalyzer](./faastjs.costanalyzer.md)

## CostAnalyzer namespace

Analyze the cost of a workload across many provider configurations.

<b>Signature:</b>

```typescript
export declare namespace CostAnalyzer 
```

## Classes

|  Class | Description |
|  --- | --- |
|  [Result](./faastjs.costanalyzer.result.md) | Cost analyzer results for each workload and configuration. |

## Functions

|  Function | Description |
|  --- | --- |
|  [analyze(mod, fmodule, userWorkload, configurations)](./faastjs.costanalyzer.analyze.md) | Estimate the cost of a workload using multiple configurations and providers. |

## Interfaces

|  Interface | Description |
|  --- | --- |
|  [Estimate](./faastjs.costanalyzer.estimate.md) | A cost estimate result for a specific cost analyzer configuration. |
|  [Workload](./faastjs.costanalyzer.workload.md) | A user-defined cost analyzer workload for [CostAnalyzer.analyze()](./faastjs.costanalyzer.analyze.md)<!-- -->.<!-- -->Example: |

## Variables

|  Variable | Description |
|  --- | --- |
|  [awsConfigurations](./faastjs.costanalyzer.awsconfigurations.md) | Default AWS cost analyzer configurations include all memory sizes for AWS Lambda. |
|  [googleConfigurations](./faastjs.costanalyzer.googleconfigurations.md) | Default Google Cloud Functions cost analyzer configurations include all available memory sizes. |

## Type Aliases

|  Type Alias | Description |
|  --- | --- |
|  [Configuration](./faastjs.costanalyzer.configuration.md) | An input to [CostAnalyzer.analyze()](./faastjs.costanalyzer.analyze.md)<!-- -->, specifying one configuration of faast.js to run against a workload. See [AwsOptions](./faastjs.awsoptions.md) and [GoogleOptions](./faastjs.googleoptions.md)<!-- -->. |
|  [WorkloadAttribute](./faastjs.costanalyzer.workloadattribute.md) | User-defined custom metrics for a workload. These are automatically summarized in the output; see [CostAnalyzer.Workload](./faastjs.costanalyzer.workload.md)<!-- -->. |

