[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [FunctionStats](./faastjs.functionstats.md) &gt; [returnLatency](./faastjs.functionstats.returnlatency.md)

## FunctionStats.returnLatency property

Statistics for how long it takes to return a response from the end of execution time to the receipt of the response locally. This measurement requires comparing timestamps from different machines, and is subject to clock skew and other effects. It should not be considered highly accurate. It can be useful for detecting excessively high latency problems. Faast.js attempts to correct for clock skew heuristically.

<b>Signature:</b>

```typescript
returnLatency: Statistics;
```
