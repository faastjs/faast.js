---
id: faastjs.faastmoduleproxy.off
title: FaastModuleProxy.off() method
hide_title: true
---
<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[faastjs](./faastjs.md) &gt; [FaastModuleProxy](./faastjs.faastmoduleproxy.md) &gt; [off](./faastjs.faastmoduleproxy.off.md)

## FaastModuleProxy.off() method

Deregister a callback for statistics events.

**Signature:**

```typescript
off(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void): void;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  name | "stats" |  |
|  listener | (statsEvent: [FunctionStatsEvent](./faastjs.functionstatsevent.md)<!-- -->) =&gt; void |  |

**Returns:**

void

## Remarks

Stops the callback listener from receiving future function statistics events. Calling [FaastModule.cleanup()](./faastjs.faastmodule.cleanup.md) also turns off statistics events.
