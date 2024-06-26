---
id: faastjs.costanalyzer
title: CostAnalyzer namespace
hide_title: true
---
<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[faastjs](./faastjs.md) &gt; [CostAnalyzer](./faastjs.costanalyzer.md)

## CostAnalyzer namespace

Analyze the cost of a workload across many provider configurations.

**Signature:**

```typescript
export declare namespace CostAnalyzer 
```

## Classes

<table><thead><tr><th>

Class


</th><th>

Description


</th></tr></thead>
<tbody><tr><td>

[Result](./faastjs.costanalyzer.result.md)


</td><td>

Cost analyzer results for each workload and configuration.


</td></tr>
</tbody></table>

## Functions

<table><thead><tr><th>

Function


</th><th>

Description


</th></tr></thead>
<tbody><tr><td>

[analyze(userWorkload)](./faastjs.costanalyzer.analyze.md)


</td><td>

Estimate the cost of a workload using multiple configurations and providers.


</td></tr>
</tbody></table>

## Interfaces

<table><thead><tr><th>

Interface


</th><th>

Description


</th></tr></thead>
<tbody><tr><td>

[Estimate](./faastjs.costanalyzer.estimate.md)


</td><td>

A cost estimate result for a specific cost analyzer configuration.


</td></tr>
<tr><td>

[Workload](./faastjs.costanalyzer.workload.md)


</td><td>

A user-defined cost analyzer workload for [CostAnalyzer.analyze()](./faastjs.costanalyzer.analyze.md)<!-- -->.

Example:


</td></tr>
</tbody></table>

## Variables

<table><thead><tr><th>

Variable


</th><th>

Description


</th></tr></thead>
<tbody><tr><td>

[awsConfigurations](./faastjs.costanalyzer.awsconfigurations.md)


</td><td>

Default AWS cost analyzer configurations include all memory sizes for AWS Lambda.


</td></tr>
</tbody></table>

## Type Aliases

<table><thead><tr><th>

Type Alias


</th><th>

Description


</th></tr></thead>
<tbody><tr><td>

[Configuration](./faastjs.costanalyzer.configuration.md)


</td><td>

An input to [CostAnalyzer.analyze()](./faastjs.costanalyzer.analyze.md)<!-- -->, specifying one configuration of faast.js to run against a workload. See [AwsOptions](./faastjs.awsoptions.md)<!-- -->.


</td></tr>
<tr><td>

[WorkloadAttribute](./faastjs.costanalyzer.workloadattribute.md)


</td><td>

User-defined custom metrics for a workload. These are automatically summarized in the output; see [CostAnalyzer.Workload](./faastjs.costanalyzer.workload.md)<!-- -->.


</td></tr>
</tbody></table>