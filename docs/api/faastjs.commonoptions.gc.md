---
id: faastjs.commonoptions.gc
title: CommonOptions.gc property
hide_title: true
---
<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[faastjs](./faastjs.md) &gt; [CommonOptions](./faastjs.commonoptions.md) &gt; [gc](./faastjs.commonoptions.gc.md)

## CommonOptions.gc property

Garbage collector mode. Default: `"auto"`<!-- -->.

**Signature:**

```typescript
gc?: "auto" | "force" | "off";
```

## Remarks

Garbage collection deletes resources that were created by previous instantiations of faast that were not cleaned up by [FaastModule.cleanup()](./faastjs.faastmodule.cleanup.md)<!-- -->, either because it was not called or because the process terminated and did not execute this cleanup step. In `"auto"` mode, garbage collection may be throttled to run up to once per hour no matter how many faast.js instances are created. In `"force"` mode, garbage collection is run without regard to whether another gc has already been performed recently. In `"off"` mode, garbage collection is skipped entirely. This can be useful for performance-sensitive tests, or for more control over when gc is performed.

Garbage collection is cloud-specific, but in general garbage collection should not interfere with the behavior or performance of faast cloud functions. When [FaastModule.cleanup()](./faastjs.faastmodule.cleanup.md) runs, it waits for garbage collection to complete. Therefore the cleanup step can in some circumstances take a significant amount of time even after all invocations have returned.

It is generally recommended to leave garbage collection in `"auto"` mode, otherwise garbage resources may accumulate over time and you will eventually hit resource limits on your account.

Also see [CommonOptions.retentionInDays](./faastjs.commonoptions.retentionindays.md)<!-- -->.
