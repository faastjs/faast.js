[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [Unpacked](./faastjs.unpacked.md)

## Unpacked type

The type returned by a `Promise`<!-- -->.

<b>Signature:</b>

```typescript
export declare type Unpacked<T> = T extends Promise<infer D> ? D : T;
```
