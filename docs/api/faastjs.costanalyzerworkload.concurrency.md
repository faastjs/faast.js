[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CostAnalyzerWorkload](./faastjs.costanalyzerworkload.md) &gt; [concurrency](./faastjs.costanalyzerworkload.concurrency.md)

## CostAnalyzerWorkload.concurrency property

The amount of concurrency to allow. Concurrency can arise from multiple repetitions of the same configuration, or concurrenct executions of different configurations. This concurrency limit throttles the total number of concurrent workload executions across both of these sources of concurrency. Default: 64.

<b>Signature:</b>

```typescript
concurrency?: number;
```
