[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [Limits](./faastjs.limits.md) &gt; [concurrency](./faastjs.limits.concurrency.md)

## Limits.concurrency property

The maximum number of concurrent executions of the underlying function to allow. Must be supplied, there is no default. Specifying `0` or `Infinity` is allowed and means there is no concurrency limit.

<b>Signature:</b>

```typescript
concurrency: number;
```
