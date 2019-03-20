[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [Limits](./faastjs.limits.md) &gt; [burst](./faastjs.limits.burst.md)

## Limits.burst property

The maximum number of calls to the underlying function to "burst" -- e.g. the number that can be issued immediately as long as the rate limit is not exceeded. For example, if rate is 5 and burst is 5, and 10 calls are made to the throttled function, 5 calls are made immediately and then after 1 second, another 5 calls are made immediately. Setting burst to 1 means calls are issued uniformly every `1/rate` seconds. If `rate` is not specified, then `burst` does not apply. Default: 1.

<b>Signature:</b>

```typescript
burst?: number;
```
