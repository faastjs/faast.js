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
|  provider | `Provider` | One of `"aws"`<!-- -->, `"google"`<!-- -->, or `"local"`<!-- -->. See [Provider](./faastjs.provider.md)<!-- -->. |
|  fmodule | `M` | A module imported with `import * as AAA from "BBB";`<!-- -->. Using `require` also works but loses type information. |
|  modulePath | `string` | The path to the module, as it would be specified to `import` or `require`<!-- -->. It should be the same as `"BBB"` from importing fmodule. |
|  options | `CommonOptions` | See [CommonOptions](./faastjs.commonoptions.md)<!-- -->. |

<b>Returns:</b>

`Promise<FaastModule<M>>`

See [FaastModule](./faastjs.faastmodule.md)<!-- -->.

## Remarks

Example of usage:

```typescript
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
