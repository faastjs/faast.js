[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [faastAws](./faastjs.faastaws.md)

## faastAws() function

The main entry point for faast with AWS provider.

<b>Signature:</b>

```typescript
export declare function faastAws<M extends object>(fmodule: M, modulePath: string, options?: AwsOptions): Promise<AwsFaastModule<M>>;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  fmodule | `M` | A module imported with `import * as AAA from "BBB";`<!-- -->. Using `require` also works but loses type information. |
|  modulePath | `string` | The path to the module, as it would be specified to `import` or `require`<!-- -->. It should be the same as `"BBB"` from importing fmodule. |
|  options | `AwsOptions` |  |

<b>Returns:</b>

`Promise<AwsFaastModule<M>>`

a Promise for [AwsFaastModule](./faastjs.awsfaastmodule.md)<!-- -->.

