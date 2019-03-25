---
id: faastjs.costanalyzer.result
title: CostAnalyzer.Result class
hide_title: true
---
[faastjs](./faastjs.md) &gt; [CostAnalyzer](./faastjs.costanalyzer.md) &gt; [Result](./faastjs.costanalyzer.result.md)

## CostAnalyzer.Result class

Cost analyzer results for each workload and configuration.

<b>Signature:</b>

```typescript
class Result<T extends object, A extends string> 
```

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [estimates](./faastjs.costanalyzer.result.estimates.md) |  | `Estimate<A>[]` | Cost estimates for each configuration of the workload. See [CostAnalyzer.Estimate](./faastjs.costanalyzer.estimate.md)<!-- -->. |
|  [workload](./faastjs.costanalyzer.result.workload.md) |  | `Required<Workload<T, A>>` | The workload analyzed. |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [csv()](./faastjs.costanalyzer.result.csv.md) |  | Comma-separated output of cost analyzer. One line per cost analyzer configuration. |

## Remarks

The `estimates` property has the cost estimates for each configuration. See [CostAnalyzer.Estimate](./faastjs.costanalyzer.estimate.md)<!-- -->.
