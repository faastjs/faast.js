---
id: faastjs.localfaastmodule
title: LocalFaastModule type
hide_title: true
---
[faastjs](./faastjs.md) &gt; [LocalFaastModule](./faastjs.localfaastmodule.md)

## LocalFaastModule type

The return type of [faastLocal()](./faastjs.faastlocal.md)<!-- -->. See [FaastModuleProxy](./faastjs.faastmoduleproxy.md)<!-- -->.

<b>Signature:</b>

```typescript
export declare type LocalFaastModule<M extends object = object> = FaastModuleProxy<M, LocalOptions, LocalState>;
```