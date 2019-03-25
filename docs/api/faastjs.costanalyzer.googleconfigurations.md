---
id: faastjs.costanalyzer.googleconfigurations
title: CostAnalyzer.googleConfigurations variable
hide_title: true
---
[faastjs](./faastjs.md) &gt; [CostAnalyzer](./faastjs.costanalyzer.md) &gt; [googleConfigurations](./faastjs.costanalyzer.googleconfigurations.md)

## CostAnalyzer.googleConfigurations variable

Default Google Cloud Functions cost analyzer configurations include all available memory sizes.

<b>Signature:</b>

```typescript
googleConfigurations: Configuration[]
```

## Remarks

Each google cost analyzer configuration follows this template:

```typescript
{
    provider: "google",
    options: {
        mode: "https",
        memorySize,
        timeout: 300,
        gc: false,
        childProcess: true
    }
}

```
where `memorySize` is in `[128, 256, 512, 1024, 2048]`<!-- -->.
