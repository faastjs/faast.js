---
id: faastjs.commonoptions.gc
title: CommonOptions.gc property
hide_title: true
---
[faastjs](./faastjs.md) &gt; [CommonOptions](./faastjs.commonoptions.md) &gt; [gc](./faastjs.commonoptions.gc.md)

## CommonOptions.gc property

Garbage collection is enabled if true. Default: true.

<b>Signature:</b>

```typescript
gc?: boolean;
```

## Remarks

Garbage collection deletes resources that were created by previous instantiations of faast that were not cleaned up by [FaastModule.cleanup()](./faastjs.faastmodule.cleanup.md)<!-- -->, either because it was not called or because the process terminated and did not execute this cleanup step.

Garbage collection is cloud-specific, but in general garbage collection should not interfere with the behavior or performance of faast cloud functions. When [FaastModule.cleanup()](./faastjs.faastmodule.cleanup.md) runs, it waits for garbage collection to complete. Therefore the cleanup step can in some circumstances take a significant amount of time even after all invocations have returned.

It is generally recommended to leave garbage collection on, otherwise garbage resources may accumulate over time and you will eventually hit resource limits on your account.

One use case for turning off garbage collection is when many invocations of faast are occurring in separate processes. In this case it can make sense to leave gc on in only one process. Note that if faast is invoked multiple times within one process, faast will automatically only run gc once every hour.

Also see [CommonOptions.retentionInDays](./faastjs.commonoptions.retentionindays.md)<!-- -->.
