---
id: faastjs.faastmoduleproxy
title: FaastModuleProxy class
hide_title: true
---
<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[faastjs](./faastjs.md) &gt; [FaastModuleProxy](./faastjs.faastmoduleproxy.md)

## FaastModuleProxy class

Implementation of [FaastModule](./faastjs.faastmodule.md)<!-- -->.

<b>Signature:</b>

```typescript
export declare class FaastModuleProxy<M extends object, O, S> implements FaastModule<M> 
```
<b>Implements:</b> [FaastModule](./faastjs.faastmodule.md)<!-- -->&lt;M&gt;

## Remarks

`FaastModuleProxy` provides a unified developer experience for faast.js modules on top of provider-specific runtime APIs. Most users will not create `FaastModuleProxy` instances themselves; instead use [faast()](./faastjs.faast.md)<!-- -->, or [faastAws()](./faastjs.faastaws.md)<!-- -->, [faastGoogle()](./faastjs.faastgoogle.md)<!-- -->, or [faastLocal()](./faastjs.faastlocal.md)<!-- -->. `FaastModuleProxy` implements the [FaastModule](./faastjs.faastmodule.md) interface, which is the preferred public interface for faast modules. `FaastModuleProxy` can be used to access provider-specific details and state, and is useful for deeper testing.

The constructor for this class is marked as internal. Third-party code should not call the constructor directly or create subclasses that extend the `FaastModuleProxy` class.

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [functions](./faastjs.faastmoduleproxy.functions.md) |  | [ProxyModule](./faastjs.proxymodule.md)<!-- -->&lt;M&gt; | Each call of a cloud function creates a separate remote invocation. |
|  [functionsDetail](./faastjs.faastmoduleproxy.functionsdetail.md) |  | [ProxyModuleDetail](./faastjs.proxymoduledetail.md)<!-- -->&lt;M&gt; | Similar to [FaastModule.functions](./faastjs.faastmodule.functions.md) except each function returns a [Detail](./faastjs.detail.md) object |
|  [options](./faastjs.faastmoduleproxy.options.md) |  | Required&lt;[CommonOptions](./faastjs.commonoptions.md)<!-- -->&gt; | The options set for this instance, which includes default values. |
|  [provider](./faastjs.faastmoduleproxy.provider.md) |  | [Provider](./faastjs.provider.md) | The [Provider](./faastjs.provider.md)<!-- -->, e.g. "aws" or "google". |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [cleanup(userCleanupOptions)](./faastjs.faastmoduleproxy.cleanup.md) |  | Stop the faast.js runtime for this cloud function and clean up ephemeral cloud resources. |
|  [costSnapshot()](./faastjs.faastmoduleproxy.costsnapshot.md) |  | Get a near real-time cost estimate of cloud function invocations. |
|  [logUrl()](./faastjs.faastmoduleproxy.logurl.md) |  | The URL of logs generated by this cloud function. |
|  [off(name, listener)](./faastjs.faastmoduleproxy.off.md) |  | Deregister a callback for statistics events. |
|  [on(name, listener)](./faastjs.faastmoduleproxy.on.md) |  | Register a callback for statistics events. |
|  [stats(functionName)](./faastjs.faastmoduleproxy.stats.md) |  | Statistics for a specific function or the entire faast.js module. |