[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CostAnalyzerWorkload](./faastjs.costanalyzerworkload.md) &gt; [format](./faastjs.costanalyzerworkload.format.md)

## CostAnalyzerWorkload.format property

Format an attribute value for console output. This is displayed by the cost analyzer when all of the repetitions for a configuration have completed. The default returns `${attribute}:${value.toFixed(1)}`<!-- -->.

<b>Signature:</b>

```typescript
format?: (attr: A, value: number) => string;
```
