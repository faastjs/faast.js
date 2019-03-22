[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CostAnalyzer](./faastjs.costanalyzer.md) &gt; [Estimate](./faastjs.costanalyzer.estimate.md)

## CostAnalyzer.Estimate interface

A cost estimate result for a specific cost analyzer configuration.

<b>Signature:</b>

```typescript
interface Estimate<A extends string> 
```

## Properties

|  Property | Type | Description |
|  --- | --- | --- |
|  [config](./faastjs.costanalyzer.estimate.config.md) | `Configuration` | The worload configuration that was analyzed. See [CostAnalyzer.Configuration](./faastjs.costanalyzer.configuration.md)<!-- -->. |
|  [costSnapshot](./faastjs.costanalyzer.estimate.costsnapshot.md) | `CostSnapshot` | The cost snapshot for the cost analysis of the specific (workload, configuration) combination. See [CostSnapshot](./faastjs.costsnapshot.md)<!-- -->. |
|  [extraMetrics](./faastjs.costanalyzer.estimate.extrametrics.md) | `WorkloadAttribute<A>` | Additional workload metrics returned from the work function. See [CostAnalyzer.WorkloadAttribute](./faastjs.costanalyzer.workloadattribute.md)<!-- -->. |

