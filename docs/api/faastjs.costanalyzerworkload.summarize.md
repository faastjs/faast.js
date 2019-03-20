[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CostAnalyzerWorkload](./faastjs.costanalyzerworkload.md) &gt; [summarize](./faastjs.costanalyzerworkload.summarize.md)

## CostAnalyzerWorkload.summarize property

Combine [WorkloadAttribute](./faastjs.workloadattribute.md) instances returned from multiple workload executions (caused by value of [CostAnalyzerWorkload.repetitions](./faastjs.costanalyzerworkload.repetitions.md)<!-- -->). The default is a function that takes the average of each attribute.

<b>Signature:</b>

```typescript
summarize?: (summaries: WorkloadAttribute<A>[]) => WorkloadAttribute<A>;
```
