[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CostAnalyzerResult](./faastjs.costanalyzerresult.md)

## CostAnalyzerResult class

Cost analyzer results for each workload and configuration.

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
|  [csv()](./faastjs.costanalyzerresult.csv.md) |  | Comma-separated output of cost analyzer. One line per cost analyzer configuration. |

## Remarks

The `estimates` property has the cost estimates for each configuration. See [CostAnalyzerConfigurationEstimate](./faastjs.costanalyzerconfigurationestimate.md)<!-- -->.

