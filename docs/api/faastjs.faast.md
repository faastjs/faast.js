---
id: faastjs.faast
title: faast() function
hide_title: true
---
[faastjs](./faastjs.md) &gt; [faast](./faastjs.faast.md)

## faast() function

The main entry point for faast with any provider and only common options.

<b>Signature:</b>

```typescript
export declare function faast<M extends object>(provider: Provider, fmodule: M, modulePath: string, options?: CommonOptions): Promise<FaastModule<M>>;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  provider | <code>Provider</code> | One of <code>&quot;aws&quot;</code>, <code>&quot;google&quot;</code>, or <code>&quot;local&quot;</code>. See [Provider](./faastjs.provider.md)<!-- -->. |
|  fmodule | <code>M</code> | A module imported with <code>import * as AAA from &quot;BBB&quot;;</code>. Using <code>require</code> also works but loses type information. |
|  modulePath | <code>string</code> | The path to the module, as it would be specified to <code>import</code> or <code>require</code>. It should be the same as <code>&quot;BBB&quot;</code> from importing fmodule. |
|  options | <code>CommonOptions</code> | See [CommonOptions](./faastjs.commonoptions.md)<!-- -->. |

<b>Returns:</b>

`Promise<FaastModule<M>>`

See [FaastModule](./faastjs.faastmodule.md)<!-- -->.

## Remarks

Example of usage:

```typescript
import { faast } from "faastjs";
import * as mod from "./path/to/module";
async function main() {
    const faastModule = await faast("aws", mod, "./path/to/module");
    try {
        const result = await faastModule.functions.func("arg");
    } finally {
        await faastModule.cleanup();
    }
}
main();

```
