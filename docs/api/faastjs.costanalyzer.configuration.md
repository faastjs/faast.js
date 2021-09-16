---
id: faastjs.costanalyzer.configuration
title: CostAnalyzer.Configuration type
hide_title: true
---
<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[faastjs](./faastjs.md) &gt; [CostAnalyzer](./faastjs.costanalyzer.md) &gt; [Configuration](./faastjs.costanalyzer.configuration.md)

## CostAnalyzer.Configuration type

An input to [CostAnalyzer.analyze()](./faastjs.costanalyzer.analyze.md)<!-- -->, specifying one configuration of faast.js to run against a workload. See [AwsOptions](./faastjs.awsoptions.md) and [GoogleOptions](./faastjs.googleoptions.md)<!-- -->.

<b>Signature:</b>

```typescript
type Configuration = {
        provider: "aws";
        options: AwsOptions;
    } | {
        provider: "google";
        options: GoogleOptions;
    };
```
<b>References:</b> [AwsOptions](./faastjs.awsoptions.md)<!-- -->, [GoogleOptions](./faastjs.googleoptions.md)