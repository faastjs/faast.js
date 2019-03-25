---
id: faastjs.cleanupoptions.deleteresources
title: CleanupOptions.deleteResources property
hide_title: true
---
[faastjs](./faastjs.md) &gt; [CleanupOptions](./faastjs.cleanupoptions.md) &gt; [deleteResources](./faastjs.cleanupoptions.deleteresources.md)

## CleanupOptions.deleteResources property

If true, delete provider cloud resources. Default: true.

<b>Signature:</b>

```typescript
deleteResources?: boolean;
```

## Remarks

The cleanup operation has two functions: stopping the faast.js runtime and deleting cloud resources that were instantiated. If `deleteResources` is false, then only the runtime is stopped and no cloud resources are deleted. This can be useful for debugging and examining the state of resources created by faast.js.

It is supported to call [FaastModule.cleanup()](./faastjs.faastmodule.cleanup.md) twice: once with `deleteResources` set to `false`<!-- -->, which only stops the runtime, and then again set to `true` to delete resources. This can be useful for testing.
