[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [FaastModuleProxy](./faastjs.faastmoduleproxy.md)

## FaastModuleProxy class

Implementation of the faast.js runtime.

<b>Signature:</b>

```typescript
export declare class FaastModuleProxy<M extends object, O, S> implements FaastModule<M> 
```

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [functions](./faastjs.faastmoduleproxy.functions.md) |  | `Promisified<M>` |  |
|  [options](./faastjs.faastmoduleproxy.options.md) |  | `Required<CommonOptions>` |  |
|  [provider](./faastjs.faastmoduleproxy.provider.md) |  | `Provider` |  |
|  [state](./faastjs.faastmoduleproxy.state.md) |  | `S` |  |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [cleanup(userCleanupOptions)](./faastjs.faastmoduleproxy.cleanup.md) |  |  |
|  [costSnapshot()](./faastjs.faastmoduleproxy.costsnapshot.md) |  |  |
|  [logUrl()](./faastjs.faastmoduleproxy.logurl.md) |  |  |
|  [off(name, listener)](./faastjs.faastmoduleproxy.off.md) |  |  |
|  [on(name, listener)](./faastjs.faastmoduleproxy.on.md) |  |  |
|  [stats(functionName)](./faastjs.faastmoduleproxy.stats.md) |  |  |

## Remarks

`FaastModuleProxy` provides a unified developer experience for faast.js modules on top of provider-specific runtime APIs. Most users will not create `FaastModuleProxy` instances themselves; instead use [faast()](./faastjs.faast.md)<!-- -->, or [faastAws()](./faastjs.faastaws.md)<!-- -->, [faastGoogle()](./faastjs.faastgoogle.md)<!-- -->, or [faastLocal()](./faastjs.faastlocal.md)<!-- -->. `FaastModuleProxy` implements the [FaastModule](./faastjs.faastmodule.md) interface, which is the preferred public interface for faast modules. `FaastModuleProxy` can be used to access provider-specific details and state, and is useful for deeper testing.

