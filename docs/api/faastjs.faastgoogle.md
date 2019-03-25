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
|  fmodule | <code>M</code> | A module imported with <code>import * as AAA from &quot;BBB&quot;;</code>. Using <code>require</code> also works but loses type information. |
|  modulePath | <code>string</code> | The path to the module, as it would be specified to <code>import</code> or <code>require</code>. It should be the same as <code>&quot;BBB&quot;</code> from importing fmodule. |
|  options | <code>GoogleOptions</code> |  |

<b>Returns:</b>

`Promise<GoogleFaastModule<M>>`

a Promise for [GoogleFaastModule](./faastjs.googlefaastmodule.md)<!-- -->.
