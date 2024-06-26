---
id: faastjs.statistics
title: Statistics class
hide_title: true
---
<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[faastjs](./faastjs.md) &gt; [Statistics](./faastjs.statistics.md)

## Statistics class

Incrementally updated statistics on a set of values.

**Signature:**

```typescript
export declare class Statistics 
```

## Constructors

<table><thead><tr><th>

Constructor


</th><th>

Modifiers


</th><th>

Description


</th></tr></thead>
<tbody><tr><td>

[(constructor)(printFixedPrecision)](./faastjs.statistics._constructor_.md)


</td><td>


</td><td>

Incrementally track mean, stdev, min, max, of a sequence of values.


</td></tr>
</tbody></table>

## Properties

<table><thead><tr><th>

Property


</th><th>

Modifiers


</th><th>

Type


</th><th>

Description


</th></tr></thead>
<tbody><tr><td>

[max](./faastjs.statistics.max.md)


</td><td>


</td><td>

number


</td><td>

The maximum value observed. Initialized to `Number.NEGATIVE_INFINITY`<!-- -->.


</td></tr>
<tr><td>

[mean](./faastjs.statistics.mean.md)


</td><td>


</td><td>

number


</td><td>

The mean (average) of the values observed.


</td></tr>
<tr><td>

[min](./faastjs.statistics.min.md)


</td><td>


</td><td>

number


</td><td>

The minimum value observed. Initialized to `Number.POSITIVE_INFINITY`<!-- -->.


</td></tr>
<tr><td>

[printFixedPrecision](./faastjs.statistics.printfixedprecision.md)


</td><td>

`protected`


</td><td>

number


</td><td>

The number of decimal places to print in [Statistics.toString()](./faastjs.statistics.tostring.md)


</td></tr>
<tr><td>

[samples](./faastjs.statistics.samples.md)


</td><td>


</td><td>

number


</td><td>

Number of values observed.


</td></tr>
<tr><td>

[stdev](./faastjs.statistics.stdev.md)


</td><td>


</td><td>

number


</td><td>

The standard deviation of the values observed.


</td></tr>
<tr><td>

[variance](./faastjs.statistics.variance.md)


</td><td>


</td><td>

number


</td><td>

The variance of the values observed.


</td></tr>
</tbody></table>

## Methods

<table><thead><tr><th>

Method


</th><th>

Modifiers


</th><th>

Description


</th></tr></thead>
<tbody><tr><td>

[toString()](./faastjs.statistics.tostring.md)


</td><td>


</td><td>

Print the mean of the observations seen, with the precision specified in the constructor.


</td></tr>
<tr><td>

[update(value)](./faastjs.statistics.update.md)


</td><td>


</td><td>

Update statistics with a new value in the sequence.


</td></tr>
</tbody></table>