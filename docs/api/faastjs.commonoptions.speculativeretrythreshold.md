---
id: faastjs.commonoptions.speculativeretrythreshold
title: CommonOptions.speculativeRetryThreshold property
hide_title: true
---
[faastjs](./faastjs.md) &gt; [CommonOptions](./faastjs.commonoptions.md) &gt; [speculativeRetryThreshold](./faastjs.commonoptions.speculativeretrythreshold.md)

## CommonOptions.speculativeRetryThreshold property

> This API is provided as a preview for developers and may change based on feedback that we receive. Do not use this API in a production environment.
> 

Reduce tail latency by retrying invocations that take substantially longer than other invocations of the same function. Default: 3.

<b>Signature:</b>

```typescript
speculativeRetryThreshold?: number;
```

## Remarks

faast.js automatically measures the mean and standard deviation (σ) of the time taken by invocations of each function. Retries are attempted when the time for an invocation exceeds the mean time by a certain threshold. `speculativeRetryThreshold` specifies how many multiples of σ an invocation needs to exceed the mean for a given function before retry is attempted.

The default value of σ is 3. This means a call to a function is retried when the time to execute exceeds three standard deviations from the mean of all prior executions of the same function.

This feature is experimental.
