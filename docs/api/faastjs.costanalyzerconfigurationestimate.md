[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CostAnalyzerConfigurationEstimate](./faastjs.costanalyzerconfigurationestimate.md)

## CostAnalyzerConfigurationEstimate interface

A cost estimate result for a specific cost analyzer configuration.

<b>Signature:</b>

```typescript
export interface CostAnalyzerConfigurationEstimate<A extends string> 
```

## Properties

|  Property | Type | Description |
|  --- | --- | --- |
|  [config](./faastjs.costanalyzerconfigurationestimate.config.md) | `CostAnalyzerConfiguration` | The worload configuration that was analyzed. See [CostAnalyzerConfiguration](./faastjs.costanalyzerconfiguration.md)<!-- -->. |
|  [costSnapshot](./faastjs.costanalyzerconfigurationestimate.costsnapshot.md) | `CostSnapshot` | The cost snapshot for the cost analysis of the specific (workload, configuration) combination. See [CostSnapshot](./faastjs.costsnapshot.md)<!-- -->. |
|  [extraMetrics](./faastjs.costanalyzerconfigurationestimate.extrametrics.md) | `WorkloadAttribute<A>` | Additional workload metrics returned from the work function. See [WorkloadAttribute](./faastjs.workloadattribute.md)<!-- -->. |

