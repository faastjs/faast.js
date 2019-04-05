---
id: faastjs.faastmoduleproxy.stats
title: FaastModuleProxy.stats() method
hide_title: true
---
[faastjs](./faastjs.md) &gt; [FaastModuleProxy](./faastjs.faastmoduleproxy.md) &gt; [stats](./faastjs.faastmoduleproxy.stats.md)

## FaastModuleProxy.stats() method

Statistics for a specific function or the entire faast.js module.

<b>Signature:</b>

```typescript
stats(functionName?: string): FunctionStats;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  functionName | <code>string</code> | The name of the function to retrieve statistics for. If the function does not exist or has not been invoked, a new instance of [FunctionStats](./faastjs.functionstats.md) is returned with zero values. If <code>functionName</code> omitted (undefined), then aggregate statistics are returned that summarize all cloud functions within this faast.js module. |

<b>Returns:</b>

`FunctionStats`

an snapshot of [FunctionStats](./faastjs.functionstats.md) at a point in time.
