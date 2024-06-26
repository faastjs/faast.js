---
id: faastjs.functionstatsevent
title: FunctionStatsEvent class
hide_title: true
---
<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[faastjs](./faastjs.md) &gt; [FunctionStatsEvent](./faastjs.functionstatsevent.md)

## FunctionStatsEvent class

Summarize statistics about cloud function invocations.

**Signature:**

```typescript
export declare class FunctionStatsEvent 
```

## Remarks

The constructor for this class is marked as internal. Third-party code should not call the constructor directly or create subclasses that extend the `FunctionStatsEvent` class.

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

[fn](./faastjs.functionstatsevent.fn.md)


</td><td>

`readonly`


</td><td>

string


</td><td>

The name of the cloud function the statistics are about.


</td></tr>
<tr><td>

[stats](./faastjs.functionstatsevent.stats.md)


</td><td>

`readonly`


</td><td>

[FunctionStats](./faastjs.functionstats.md)


</td><td>

See [FunctionStats](./faastjs.functionstats.md)<!-- -->.


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

[toString()](./faastjs.functionstatsevent.tostring.md)


</td><td>


</td><td>

Returns a string summarizing the statistics event.


</td></tr>
</tbody></table>