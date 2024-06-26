---
id: faastjs.costmetric
title: CostMetric class
hide_title: true
---
<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[faastjs](./faastjs.md) &gt; [CostMetric](./faastjs.costmetric.md)

## CostMetric class

A line item in the cost estimate, including the resource usage metric measured and its pricing.

**Signature:**

```typescript
export declare class CostMetric 
```

## Remarks

The constructor for this class is marked as internal. Third-party code should not call the constructor directly or create subclasses that extend the `CostMetric` class.

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

[comment?](./faastjs.costmetric.comment.md)


</td><td>

`readonly`


</td><td>

string


</td><td>

_(Optional)_ An optional comment, usually providing a link to the provider's pricing page and other data.


</td></tr>
<tr><td>

[informationalOnly?](./faastjs.costmetric.informationalonly.md)


</td><td>

`readonly`


</td><td>

boolean


</td><td>

_(Optional)_ True if this cost metric is only for informational purposes (e.g. AWS's `logIngestion`<!-- -->) and does not contribute cost.


</td></tr>
<tr><td>

[measured](./faastjs.costmetric.measured.md)


</td><td>

`readonly`


</td><td>

number


</td><td>

The measured value of the cost metric, in units.


</td></tr>
<tr><td>

[name](./faastjs.costmetric.name.md)


</td><td>

`readonly`


</td><td>

string


</td><td>

The name of the cost metric, e.g. `functionCallDuration`


</td></tr>
<tr><td>

[pricing](./faastjs.costmetric.pricing.md)


</td><td>

`readonly`


</td><td>

number


</td><td>

The price in USD per unit measured.


</td></tr>
<tr><td>

[unit](./faastjs.costmetric.unit.md)


</td><td>

`readonly`


</td><td>

string


</td><td>

The name of the units that pricing is measured in for this metric.


</td></tr>
<tr><td>

[unitPlural?](./faastjs.costmetric.unitplural.md)


</td><td>

`readonly`


</td><td>

string


</td><td>

_(Optional)_ The plural form of the unit name. By default the plural form will be the name of the unit with "s" appended at the end, unless the last letter is capitalized, in which case there is no plural form (e.g. "GB").


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

[cost()](./faastjs.costmetric.cost.md)


</td><td>


</td><td>

The cost contribution of this cost metric. Equal to [CostMetric.pricing](./faastjs.costmetric.pricing.md) \* [CostMetric.measured](./faastjs.costmetric.measured.md)<!-- -->.


</td></tr>
<tr><td>

[describeCostOnly()](./faastjs.costmetric.describecostonly.md)


</td><td>


</td><td>

Return a string with the cost estimate for this metric, omitting comments.


</td></tr>
<tr><td>

[toString()](./faastjs.costmetric.tostring.md)


</td><td>


</td><td>

Describe this cost metric, including comments.


</td></tr>
</tbody></table>