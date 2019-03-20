[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CostAnalyzerResult](./faastjs.costanalyzerresult.md)

## CostAnalyzerResult class

Cost analyzer results for each workload and configuration.

The `estimates` property has the cost estimates for each configuration. See [CostAnalyzerConfigurationEstimate](./faastjs.costanalyzerconfigurationestimate.md)<!-- -->.

<b>Signature:</b>

```typescript
export declare class CostAnalyzerResult<T extends object, A extends string> 
```

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [estimates](./faastjs.costanalyzerresult.estimates.md) |  | `CostAnalyzerConfigurationEstimate<A>[]` | Cost estimates for each configuration of the workload. See [CostAnalyzerConfigurationEstimate](./faastjs.costanalyzerconfigurationestimate.md)<!-- -->. |
|  [workload](./faastjs.costanalyzerresult.workload.md) |  | `Required<CostAnalyzerWorkload<T, A>>` | The workload analyzed. |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [csv()](./faastjs.costanalyzerresult.csv.md) |  | Comma-separated output of cost analyzer. There is one row per cost analyzer configuration. The columns are:<!-- -->- `memory`<!-- -->: The memory size allocated. - `cloud`<!-- -->: The cloud provider. - `mode`<!-- -->: See [CommonOptions.mode](./faastjs.commonoptions.mode.md)<!-- -->. - `options`<!-- -->: A string summarizing other faast.js options applied to the `workload`<!-- -->. See [CommonOptions](./faastjs.commonoptions.md)<!-- -->. - `completed`<!-- -->: Number of repetitions that successfully completed. - `errors`<!-- -->: Number of invocations that failed. - `retries`<!-- -->: Number of retries that were attempted. - `cost`<!-- -->: The average cost of executing the workload once. - `executionTime`<!-- -->: the aggregate time spent executing on the provider for all cloud function invocations in the workload. This is averaged across repetitions. - `executionTimeStdev`<!-- -->: The standard deviation of `executionTime`<!-- -->. - `billedTime`<!-- -->: the same as `exectionTime`<!-- -->, except rounded up to the next 100ms for each invocation. Usually very close to `executionTime`<!-- -->. |

