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
|  [max](./faastjs.statistics.max.md) |  | <code>number</code> | The maximum value observed. Initialized to <code>Number.NEGATIVE_INFINITY</code>. |
|  [mean](./faastjs.statistics.mean.md) |  | <code>number</code> | The mean (average) of the values observed. |
|  [min](./faastjs.statistics.min.md) |  | <code>number</code> | The minimum value observed. Initialized to <code>Number.POSITIVE_INFINITY</code>. |
|  [printFixedPrecision](./faastjs.statistics.printfixedprecision.md) |  | <code>number</code> |  |
|  [samples](./faastjs.statistics.samples.md) |  | <code>number</code> | Number of values observed. |
|  [stdev](./faastjs.statistics.stdev.md) |  | <code>number</code> | The standard deviation of the values observed. |
|  [variance](./faastjs.statistics.variance.md) |  | <code>number</code> | The variance of the values observed. |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [toString()](./faastjs.statistics.tostring.md) |  | Print the mean of the observations seen, with the precision specified in the constructor. |
|  [update(value)](./faastjs.statistics.update.md) |  | Update statistics with a new value in the sequence. |
