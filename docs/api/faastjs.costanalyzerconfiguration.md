[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CostAnalyzerConfiguration](./faastjs.costanalyzerconfiguration.md)

## CostAnalyzerConfiguration type

An input to [costAnalyzer()](./faastjs.costanalyzer.md)<!-- -->, specifying one configuration of faast.js to run against a workload. See [AwsOptions](./faastjs.awsoptions.md) and [GoogleOptions](./faastjs.googleoptions.md)<!-- -->.

<b>Signature:</b>

```typescript
export declare type CostAnalyzerConfiguration = {
    provider: "aws";
    options: AwsOptions;
} | {
    provider: "google";
    options: GoogleOptions;
};
```
