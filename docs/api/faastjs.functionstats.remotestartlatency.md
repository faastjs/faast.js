[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [FunctionStats](./faastjs.functionstats.md) &gt; [remoteStartLatency](./faastjs.functionstats.remotestartlatency.md)

## FunctionStats.remoteStartLatency property

Statistics for how long requests take to start execution after being sent to the cloud provider. This typically includes remote queueing and cold start times. Because this measurement requires comparing timestamps from different machines, it is subject to clock skew and other effects, and should not be considered highly accurate. It can be useful for detecting excessively high latency problems. Faast.js attempt to correct for clock skew heuristically.

<b>Signature:</b>

```typescript
remoteStartLatency: Statistics;
```
