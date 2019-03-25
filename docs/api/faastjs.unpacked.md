---
id: faastjs.unpacked
title: Unpacked type
hide_title: true
---
[faastjs](./faastjs.md) &gt; [Unpacked](./faastjs.unpacked.md)

## Unpacked type

The type returned by a `Promise`<!-- -->.

<b>Signature:</b>

```typescript
export declare type Unpacked<T> = T extends Promise<infer D> ? D : T;
```