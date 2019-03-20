[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [WorkloadAttribute](./faastjs.workloadattribute.md)

## WorkloadAttribute type

User-defined custom metrics for a workload. These are automatically summarized in the output; see [CostAnalyzerWorkload](./faastjs.costanalyzerworkload.md)<!-- -->.

<b>Signature:</b>

```typescript
export declare type WorkloadAttribute<A extends string> = {
    [attr in A]: number;
};
```
