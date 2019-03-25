---
id: faastjs.statistics
title: Statistics class
hide_title: true
---
[faastjs](./faastjs.md) &gt; [Statistics](./faastjs.statistics.md)

## Statistics class

Incrementally updated statistics on a set of values.

<b>Signature:</b>

```typescript
export declare class Statistics 
```

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [max](./faastjs.statistics.max.md) |  | `number` | The maximum value observed. Initialized to `Number.NEGATIVE_INFINITY`<!-- -->. |
|  [mean](./faastjs.statistics.mean.md) |  | `number` | The mean (average) of the values observed. |
|  [min](./faastjs.statistics.min.md) |  | `number` | The minimum value observed. Initialized to `Number.POSITIVE_INFINITY`<!-- -->. |
|  [printFixedPrecision](./faastjs.statistics.printfixedprecision.md) |  | `number` |  |
|  [samples](./faastjs.statistics.samples.md) |  | `number` | Number of values observed. |
|  [stdev](./faastjs.statistics.stdev.md) |  | `number` | The standard deviation of the values observed. |
|  [variance](./faastjs.statistics.variance.md) |  | `number` | The variance of the values observed. |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [toString()](./faastjs.statistics.tostring.md) |  | Print the mean of the observations seen, with the precision specified in the constructor. |
|  [update(value)](./faastjs.statistics.update.md) |  | Update statistics with a new value in the sequence. |
