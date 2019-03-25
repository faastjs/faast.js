---
id: faastjs.promisified
title: Promisified type
hide_title: true
---
[faastjs](./faastjs.md) &gt; [Promisified](./faastjs.promisified.md)

## Promisified type

`Promisified<M>` is the type of [FaastModule.functions](./faastjs.faastmodule.functions.md)<!-- -->.

<b>Signature:</b>

```typescript
export declare type Promisified<M> = {
    [K in keyof M]: M[K] extends (...args: infer A) => infer R ? PromisifiedFunction<A, R> : never;
};
```

## Remarks

`Promisified<M>` maps an imported module's functions to promise-returning versions of those functions (see [PromisifiedFunction](./faastjs.promisifiedfunction.md)<!-- -->). Non-function exports of the module are omitted.
