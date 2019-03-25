---
id: faastjs.faastgoogle
title: faastGoogle() function
hide_title: true
---
[faastjs](./faastjs.md) &gt; [faastGoogle](./faastjs.faastgoogle.md)

## faastGoogle() function

The main entry point for faast with Google provider.

<b>Signature:</b>

```typescript
export declare function faastGoogle<M extends object>(fmodule: M, modulePath: string, options?: GoogleOptions): Promise<GoogleFaastModule<M>>;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  fmodule | `M` | A module imported with `import * as AAA from "BBB";`<!-- -->. Using `require` also works but loses type information. |
|  modulePath | `string` | The path to the module, as it would be specified to `import` or `require`<!-- -->. It should be the same as `"BBB"` from importing fmodule. |
|  options | `GoogleOptions` |  |

<b>Returns:</b>

`Promise<GoogleFaastModule<M>>`

a Promise for [GoogleFaastModule](./faastjs.googlefaastmodule.md)<!-- -->.
