[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CostAnalyzer](./faastjs.costanalyzer.md) &gt; [Workload](./faastjs.costanalyzer.workload.md) &gt; [summarize](./faastjs.costanalyzer.workload.summarize.md)

## CostAnalyzer.Workload.summarize property

Combine [CostAnalyzer.WorkloadAttribute](./faastjs.costanalyzer.workloadattribute.md) instances returned from multiple workload executions (caused by value of [CostAnalyzer.Workload.repetitions](./faastjs.costanalyzer.workload.repetitions.md)<!-- -->). The default is a function that takes the average of each attribute.

<b>Signature:</b>

```typescript
summarize?: (summaries: WorkloadAttribute<A>[]) => WorkloadAttribute<A>;
```
