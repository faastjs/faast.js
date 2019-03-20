[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [awsConfigurations](./faastjs.awsconfigurations.md)

## awsConfigurations variable

Default AWS cost analyzer configurations include all memory sizes for AWS Lambda.

<b>Signature:</b>

```typescript
awsConfigurations: CostAnalyzerConfiguration[]
```

## Remarks

The default AWS cost analyzer configurations include every memory size from 128MB to 3008MB in 64MB increments. Each configuration has the following settings:

```typescript
{
    provider: "aws",
    options: {
        mode: "queue",
        memorySize,
        timeout: 300,
        gc: false,
        childProcess: true
    }
}

```
Use `Array.map` to change or `Array.filter` to remove some of these configurations. For example:

```typescript
const configsWithAtLeast1GB = awsConfigurations.filter(c => c.memorySize > 1024)
const shorterTimeout = awsConfigurations.map(c => ({...c, timeout: 60 }));

```

