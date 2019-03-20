[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [FaastModule](./faastjs.faastmodule.md) &gt; [stats](./faastjs.faastmodule.stats.md)

## FaastModule.stats() method

Statistics for a specific function or the entire faast.js module.

<b>Signature:</b>

```typescript
stats(functionName?: string): FunctionStats;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  functionName | `string` | The name of the function to retrieve statistics for. If the function does not exist or has not been invoked, a new instance of [FunctionStats](./faastjs.functionstats.md) is returned with zero values. If `functionName` omitted (undefined), then aggregate statistics are returned that summarize all cloud functions within this faast.js module. |

<b>Returns:</b>

`FunctionStats`

an snapshot of [FunctionStats](./faastjs.functionstats.md) at a point in time.

