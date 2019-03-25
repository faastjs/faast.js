---
id: faastjs.costanalyzer.workloadattribute
title: CostAnalyzer.WorkloadAttribute type
hide_title: true
---
[faastjs](./faastjs.md) &gt; [CostAnalyzer](./faastjs.costanalyzer.md) &gt; [WorkloadAttribute](./faastjs.costanalyzer.workloadattribute.md)

## CostAnalyzer.WorkloadAttribute type

User-defined custom metrics for a workload. These are automatically summarized in the output; see [CostAnalyzer.Workload](./faastjs.costanalyzer.workload.md)<!-- -->.

<b>Signature:</b>

```typescript
type WorkloadAttribute<A extends string> = {
        [attr in A]: number;
    };
```