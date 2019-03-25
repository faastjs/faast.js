---
id: faastjs.costanalyzer.workload.format
title: CostAnalyzer.Workload.format property
hide_title: true
---
[faastjs](./faastjs.md) &gt; [CostAnalyzer](./faastjs.costanalyzer.md) &gt; [Workload](./faastjs.costanalyzer.workload.md) &gt; [format](./faastjs.costanalyzer.workload.format.md)

## CostAnalyzer.Workload.format property

Format an attribute value for console output. This is displayed by the cost analyzer when all of the repetitions for a configuration have completed. The default returns `${attribute}:${value.toFixed(1)}`<!-- -->.

<b>Signature:</b>

```typescript
format?: (attr: A, value: number) => string;
```