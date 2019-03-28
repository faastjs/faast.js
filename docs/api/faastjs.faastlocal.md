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
|  fmodule | <code>M</code> | A module imported with <code>import * as AAA from &quot;BBB&quot;;</code>. Using <code>require</code> also works but loses type information. |
|  modulePath | <code>string</code> | The path to the module, as it would be specified to <code>import</code> or <code>require</code>. It should be the same as <code>&quot;BBB&quot;</code> from importing fmodule. |
|  options | <code>LocalOptions</code> | Most common options are in [CommonOptions](./faastjs.commonoptions.md)<!-- -->. Additional Local-specific options are in [LocalOptions](./faastjs.localoptions.md)<!-- -->. |

<b>Returns:</b>

`Promise<LocalFaastModule<M>>`

a Promise for [LocalFaastModule](./faastjs.localfaastmodule.md)<!-- -->.
