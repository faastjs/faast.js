---
id: faastjs.faastmodule.on
title: FaastModule.on() method
hide_title: true
---
[faastjs](./faastjs.md) &gt; [FaastModule](./faastjs.faastmodule.md) &gt; [on](./faastjs.faastmodule.on.md)

## FaastModule.on() method

Register a callback for statistics events.

<b>Signature:</b>

```typescript
on(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void): void;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  name | <code>&quot;stats&quot;</code> |  |
|  listener | <code>(statsEvent: FunctionStatsEvent) =&gt; void</code> |  |

<b>Returns:</b>

`void`

## Remarks

The callback is invoked once for each cloud function that was invoked within the last 1s interval, with a [FunctionStatsEvent](./faastjs.functionstatsevent.md) summarizing the statistics for each function. Typical usage:

```typescript
faastModule.on("stats", console.log);

```
