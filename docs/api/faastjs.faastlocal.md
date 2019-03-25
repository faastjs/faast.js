---
id: faastjs.faastlocal
title: faastLocal() function
hide_title: true
---
[faastjs](./faastjs.md) &gt; [faastLocal](./faastjs.faastlocal.md)

## faastLocal() function

The main entry point for faast with Local provider.

<b>Signature:</b>

```typescript
export declare function faastLocal<M extends object>(fmodule: M, modulePath: string, options?: LocalOptions): Promise<LocalFaastModule<M>>;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  fmodule | `M` | A module imported with `import * as AAA from "BBB";`<!-- -->. Using `require` also works but loses type information. |
|  modulePath | `string` | The path to the module, as it would be specified to `import` or `require`<!-- -->. It should be the same as `"BBB"` from importing fmodule. |
|  options | `LocalOptions` |  |

<b>Returns:</b>

`Promise<LocalFaastModule<M>>`

a Promise for [LocalFaastModule](./faastjs.localfaastmodule.md)<!-- -->.
