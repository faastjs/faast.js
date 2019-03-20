[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [Limits](./faastjs.limits.md) &gt; [retry](./faastjs.limits.retry.md)

## Limits.retry property

Retry if the throttled function returns a rejected promise. `retry` can be a number or a function. If it is a number `N`<!-- -->, then up to `N` additional attempts are made in addition to the initial call. If retry is a function, it should return `true` if another retry attempt should be made, otherwise `false`<!-- -->. The first argument will be the value of the rejected promise from the previous call attempt, and the second argument will be the number of previous retry attempts (e.g. the first call will have value 0). Default: 0 (no retry attempts).

<b>Signature:</b>

```typescript
retry?: number | ((err: any, retries: number) => boolean);
```
