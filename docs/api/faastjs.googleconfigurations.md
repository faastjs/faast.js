[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [googleConfigurations](./faastjs.googleconfigurations.md)

## googleConfigurations variable

Default Google Cloud Functions cost analyzer configurations include all available memory sizes.

<b>Signature:</b>

```typescript
googleConfigurations: CostAnalyzerConfiguration[]
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

