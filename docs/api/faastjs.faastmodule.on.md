---
id: faastjs.faastmodule.on
title: FaastModule.on() method
hide_title: true
---
<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[faastjs](./faastjs.md) &gt; [FaastModule](./faastjs.faastmodule.md) &gt; [on](./faastjs.faastmodule.on.md)

## FaastModule.on() method

Register a callback for statistics events.

**Signature:**

```typescript
on(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void): void;
```

## Parameters

<table><thead><tr><th>

Parameter


</th><th>

Type


</th><th>

Description


</th></tr></thead>
<tbody><tr><td>

name


</td><td>

"stats"


</td><td>


</td></tr>
<tr><td>

listener


</td><td>

(statsEvent: [FunctionStatsEvent](./faastjs.functionstatsevent.md)<!-- -->) =&gt; void


</td><td>


</td></tr>
</tbody></table>
**Returns:**

void

## Remarks

The callback is invoked once for each cloud function that was invoked within the last 1s interval, with a [FunctionStatsEvent](./faastjs.functionstatsevent.md) summarizing the statistics for each function. Typical usage:

```typescript
faastModule.on("stats", console.log);
```
