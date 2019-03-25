---
id: faastjs.commonoptions.retentionindays
title: CommonOptions.retentionInDays property
hide_title: true
---
[faastjs](./faastjs.md) &gt; [CommonOptions](./faastjs.commonoptions.md) &gt; [retentionInDays](./faastjs.commonoptions.retentionindays.md)

## CommonOptions.retentionInDays property

Specify how many days to wait before reclaiming cloud garbage. Default: 1.

<b>Signature:</b>

```typescript
retentionInDays?: number;
```

## Remarks

Garbage collection only deletes resources after they age beyond a certain number of days. This option specifies how many days old a resource needs to be before being considered garbage by the collector. Note that this setting is not recorded when the resources are created. For example, suppose this is the sequence of events:

- Day 0: `faast()` is called with `retentionInDays` set to 5. Then, the function crashes (or omits the call to [FaastModule.cleanup()](./faastjs.faastmodule.cleanup.md)<!-- -->).

- Day 1: `faast()` is called with `retentionInDays` set to 1.

In this sequence of events, on Day 0 the garbage collector runs and removes resources with age older than 5 days. Then the function leaves new garbage behind because it crashed or did not complete cleanup. On Day 1, the garbage collector runs and deletes resources at least 1 day old, which includes garbage left behind from Day 0 (based on the creation timestamp of the resources). This deletion occurs even though retention was set to 5 days when resources were created on Day 0.

On Google, logs are retained according to Google's default expiration policy (30 days) instead of being deleted by garbage collection.

Note that if `retentionInDays` is set to 0, garbage collection will remove all resources, even ones that may be in use by other running faast instances. Not recommended.

See [CommonOptions.gc](./faastjs.commonoptions.gc.md)<!-- -->.
