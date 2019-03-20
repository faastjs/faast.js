[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [FaastModule](./faastjs.faastmodule.md) &gt; [off](./faastjs.faastmodule.off.md)

## FaastModule.off() method

Deregister a callback for statistics events.

<b>Signature:</b>

```typescript
off(name: "stats", listener: (statsEvent: FunctionStatsEvent) => void): void;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  name | `"stats"` |  |
|  listener | `(statsEvent: FunctionStatsEvent) => void` |  |

<b>Returns:</b>

`void`

## Remarks

Stops the callback listener from receiving future function statistics events. Calling [FaastModule.cleanup()](./faastjs.faastmodule.cleanup.md) also turns off statistics events.

