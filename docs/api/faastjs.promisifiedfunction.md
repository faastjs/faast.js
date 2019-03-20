[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [PromisifiedFunction](./faastjs.promisifiedfunction.md)

## PromisifiedFunction type

The type of functions on [FaastModule.functions](./faastjs.faastmodule.functions.md)<!-- -->. Used by [Promisified](./faastjs.promisified.md)<!-- -->.

<b>Signature:</b>

```typescript
export declare type PromisifiedFunction<A extends any[], R> = (...args: A) => Promise<Unpacked<R>>;
```

## Remarks

Given argument types A and return type R of a function, `PromisifiedFunction<A,R>` is a type with the same signature except the return value is replaced with a Promise. If the original function already returned a promise, the signature is unchanged.

