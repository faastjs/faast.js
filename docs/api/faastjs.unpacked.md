[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [Unpacked](./faastjs.unpacked.md)

## Unpacked type


<b>Signature:</b>

```typescript
export declare type Unpacked<T> = T extends Promise<infer D> ? D : T;
```
