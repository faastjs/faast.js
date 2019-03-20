[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CostAnalyzerResult](./faastjs.costanalyzerresult.md) &gt; [csv](./faastjs.costanalyzerresult.csv.md)

## CostAnalyzerResult.csv() method

Comma-separated output of cost analyzer. One line per cost analyzer configuration.

<b>Signature:</b>

```typescript
csv(): string;
```
<b>Returns:</b>

`string`

## Remarks

The columns are:

- `memory`<!-- -->: The memory size allocated.

- `cloud`<!-- -->: The cloud provider.

- `mode`<!-- -->: See [CommonOptions.mode](./faastjs.commonoptions.mode.md)<!-- -->.

- `options`<!-- -->: A string summarizing other faast.js options applied to the `workload`<!-- -->. See [CommonOptions](./faastjs.commonoptions.md)<!-- -->.

- `completed`<!-- -->: Number of repetitions that successfully completed.

- `errors`<!-- -->: Number of invocations that failed.

- `retries`<!-- -->: Number of retries that were attempted.

- `cost`<!-- -->: The average cost of executing the workload once.

- `executionTime`<!-- -->: the aggregate time spent executing on the provider for all cloud function invocations in the workload. This is averaged across repetitions.

- `executionTimeStdev`<!-- -->: The standard deviation of `executionTime`<!-- -->.

- `billedTime`<!-- -->: the same as `exectionTime`<!-- -->, except rounded up to the next 100ms for each invocation. Usually very close to `executionTime`<!-- -->.

