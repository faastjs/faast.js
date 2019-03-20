[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CommonOptions](./faastjs.commonoptions.md) &gt; [concurrency](./faastjs.commonoptions.concurrency.md)

## CommonOptions.concurrency property

The maximum number of concurrent invocations to allow. Default: 100, except for the `local` provider, where the default is 10.

<b>Signature:</b>

```typescript
concurrency?: number;
```

## Remarks

The concurrency limit applies to all invocations of all of the faast functions summed together. It is not a per-function limit. To apply a per-function limit, use [throttle()](./faastjs.throttle.md)<!-- -->. A value of 0 is equivalent to Infinity. A value of 1 ensures mutually exclusive invocations.

