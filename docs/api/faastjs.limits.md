---
id: faastjs.limits
title: Limits interface
hide_title: true
---
[faastjs](./faastjs.md) &gt; [Limits](./faastjs.limits.md)

## Limits interface

Specify throttle limits. These limits shape the way throttle invokes the underlying function.

<b>Signature:</b>

```typescript
export interface Limits 
```

## Properties

|  Property | Type | Description |
|  --- | --- | --- |
|  [burst](./faastjs.limits.burst.md) | `number` | The maximum number of calls to the underlying function to "burst" -- e.g. the number that can be issued immediately as long as the rate limit is not exceeded. For example, if rate is 5 and burst is 5, and 10 calls are made to the throttled function, 5 calls are made immediately and then after 1 second, another 5 calls are made immediately. Setting burst to 1 means calls are issued uniformly every `1/rate` seconds. If `rate` is not specified, then `burst` does not apply. Default: 1. |
|  [cache](./faastjs.limits.cache.md) | `PersistentCache` | Similar to `memoize` except the map from function arguments to results is stored in a persistent cache on disk. This is useful to prevent redundant calls to APIs which are expected to return the same results for the same arguments, and which are likely to be called across many faast.js module instantiations. This is used internally by faast.js for caching cloud prices for AWS and Google, and for saving the last garbage collection date for AWS. Persistent cache entries expire after a period of time. See [PersistentCache](./faastjs.persistentcache.md)<!-- -->. |
|  [concurrency](./faastjs.limits.concurrency.md) | `number` | The maximum number of concurrent executions of the underlying function to allow. Must be supplied, there is no default. Specifying `0` or `Infinity` is allowed and means there is no concurrency limit. |
|  [memoize](./faastjs.limits.memoize.md) | `boolean` | If `memoize` is `true`<!-- -->, then every call to the throttled function will be saved as an entry in a map from arguments to return value. If same arguments are seen again in a future call, the return value is retrieved from the Map rather than calling the function again. This can be useful for avoiding redundant calls that are expected to return the same results given the same arguments.<!-- -->The arguments will be captured with `JSON.stringify`<!-- -->, therefore types that do not stringify uniquely won't be distinguished from each other. Care must be taken when specifying `memoize` to ensure avoid incorrect results. |
|  [rate](./faastjs.limits.rate.md) | `number` | The maximum number of calls per second to allow to the underlying function. Default: no rate limit. |
|  [retry](./faastjs.limits.retry.md) | `RetryType` | Retry if the throttled function returns a rejected promise. `retry` can be a number or a function. If it is a number `N`<!-- -->, then up to `N` additional attempts are made in addition to the initial call. If retry is a function, it should return `true` if another retry attempt should be made, otherwise `false`<!-- -->. The first argument will be the value of the rejected promise from the previous call attempt, and the second argument will be the number of previous retry attempts (e.g. the first call will have value 0). Default: 0 (no retry attempts). |
