---
id: faastjs.faastmoduleproxy
title: FaastModuleProxy class
hide_title: true
---
[faastjs](./faastjs.md) &gt; [FaastModuleProxy](./faastjs.faastmoduleproxy.md)

## FaastModuleProxy class

Implementation of the faast.js runtime.

<b>Signature:</b>

```typescript
export declare class FaastModuleProxy<M extends object, O, S> implements FaastModule<M> 
```

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [functions](./faastjs.faastmoduleproxy.functions.md) |  | <code>Promisified&lt;M&gt;</code> |  |
|  [options](./faastjs.faastmoduleproxy.options.md) |  | <code>Required&lt;CommonOptions&gt;</code> |  |
|  [provider](./faastjs.faastmoduleproxy.provider.md) |  | <code>Provider</code> |  |
|  [state](./faastjs.faastmoduleproxy.state.md) |  | <code>S</code> |  |

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
