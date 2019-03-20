[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [throttle](./faastjs.throttle.md)

## throttle() function

A decorator for rate limiting, concurrency limiting, retry, memoization, and on-disk caching.

<b>Signature:</b>

```typescript
export declare function throttle<A extends any[], R>({ concurrency, retry, rate, burst, memoize, cache }: Limits, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R>;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  { concurrency, retry, rate, burst, memoize, cache } | `Limits` |  |
|  fn | `(...args: A) => Promise<R>` | The function to throttle. It can take any arguments, but must return a Promise (which includes `async` functions). |

<b>Returns:</b>

`(...args: A) => Promise<R>`

## Remarks

When programming against cloud services, databases, and other resources, it is often necessary to control the rate of request issuance to avoid overwhelming the service provider. In many cases the provider has built-in safeguards against abuse, which automatically fail requests if they are coming in too fast. Some systems don't have safeguards and precipitously degrade their service level or fail outright when faced with excessive load.

With faast.js it becomes very easy to (accidentally) generate requests from thousands of cloud functions. The `throttle` function can help manage request flow without resorting to setting up a separate service. This is in keeping with faast.js' zero-ops philosophy.

Usage is simple:

```typescript
async function operation() { ... }
const throttledOperation = throttle({ concurrency: 10, rate: 5 }, operation);
for(let i = 0; i < 100; i++) {
    // at most 10 concurrent executions at a rate of 5 invocations per second.
    throttledOperation();
}

```
Note that each invocation to `throttle` creates a separate function with a separate limits. Therefore it is likely that you want to use `throttle` in a global context, not within a dynamic context:

```typescript
async function operation() { ... }
for(let i = 0; i < 100; i++) {
    // WRONG - each iteration creates a separate throttled function that's only called once.
    const throttledOperation = throttle({ concurrency: 10, rate: 5 }, operation);
    throttledOperation();
}

```
A better way to use throttle avoids creating a named `operation` function altogether, ensuring it cannot be accidentally called without throttling:

```typescript
const operation = throttle({ concurrency: 10, rate: 5 }, async () => {
    ...
});

```
Throttle supports functions with arguments automatically infers the correct type for the returned function:

```typescript
// `operation` inferred to have type (str: string) => Promise<string>
const operation = throttle({ concurrency: 10, rate: 5 }, async (str: string) => {
    return string;
});

```
In addition to limiting concurrency and invocation rate, `throttle` also supports retrying failed invocations, memoizing calls, and on-disk caching. See [Limits](./faastjs.limits.md) for details.

