[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [costAnalyzer](./faastjs.costanalyzer.md)

## costAnalyzer() function

Estimate the cost of a workload using multiple configurations and providers.

<b>Signature:</b>

```typescript
export declare function costAnalyzer<T extends object, A extends string>(mod: T, fmodule: string, userWorkload: CostAnalyzerWorkload<T, A>, configurations?: CostAnalyzerConfiguration[]): Promise<CostAnalyzerResult<T, A>>;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  mod | `T` | The module containing the remote cloud functions to analyze. |
|  fmodule | `string` | Path to the module `mod`<!-- -->. This can be either an absolute filename (e.g. from `require.resolve`<!-- -->) or a path omitting the `.js` extension as would be use with `require` or `import`<!-- -->. |
|  userWorkload | `CostAnalyzerWorkload<T, A>` | a [CostAnalyzerWorkload](./faastjs.costanalyzerworkload.md) object specifying the workload to run and additional parameters. |
|  configurations | `CostAnalyzerConfiguration[]` | an array specifying [CostAnalyzerConfiguration](./faastjs.costanalyzerconfiguration.md)<!-- -->s to run. Default: [awsConfigurations](./faastjs.awsconfigurations.md)<!-- -->. |

<b>Returns:</b>

`Promise<CostAnalyzerResult<T, A>>`

A promise for a [CostAnalyzerResult](./faastjs.costanalyzerresult.md)

## Remarks

It can be deceptively difficult to set optimal parameters for AWS Lambda and similar services. On the surface there appears to be only one parameter: memory size. Choosing more memory also gives more CPU performance, but it's unclear how much. It's also unclear where single core performance stops getting better. The workload cost analyzer solves these problems by making it easy to run cost experiments.

```
                                                     (AWS)
                                                   ┌───────┐
                                             ┌────▶│ 128MB │
                                             │     └───────┘
                                             │     ┌───────┐
                     ┌─────────────────┐     ├────▶│ 256MB │
 ┌──────────────┐    │                 │     │     └───────┘
 │   workload   │───▶│                 │     │        ...
 └──────────────┘    │                 │     │     ┌───────┐
                     │  cost analyzer  │─────┼────▶│3008MB │
 ┌──────────────┐    │                 │     │     └───────┘
 │configurations│───▶│                 │     │
 └──────────────┘    │                 │     │     (Google)
                     └─────────────────┘     │     ┌───────┐
                                             ├────▶│ 128MB │
                                             │     └───────┘
                                             │     ┌───────┐
                                             └────▶│ 256MB │
                                                   └───────┘

```
`costAnalyzer` is the entry point. It automatically runs this workload against multiple configurations in parallel. Then it uses faast.js' cost snapshot mechanism to automatically determine the price of running the workload with each configuration.

Example:

```typescript
// functions.ts
export function randomNumbers(n: number) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
        sum += Math.random();
    }
    return sum;
}

// cost-analyzer-example.ts
import { writeFileSync } from "fs";
import { costAnalyzer, FaastModule } from "faastjs";
import * as mod from "./functions";

async function work(faastModule: FaastModule<typeof mod>) {
    await faastModule.functions.randomNumbers(100000000);
}

async function main() {
    const results = await costAnalyzer(mod, "./functions", { work });
    writeFileSync("cost.csv", results.csv());
}

main();

```
Example output (this is printed to `console.log` unless the [CostAnalyzerWorkload.silent](./faastjs.costanalyzerworkload.silent.md) is `true`<!-- -->):

```
  ✔ aws 128MB queue 15.385s 0.274σ $0.00003921
  ✔ aws 192MB queue 10.024s 0.230σ $0.00003576
  ✔ aws 256MB queue 8.077s 0.204σ $0.00003779
     ▲    ▲     ▲     ▲       ▲        ▲
     │    │     │     │       │        │
 provider │    mode   │     stdev     average
          │           │   execution  estimated
        memory        │     time       cost
         size         │
                average cloud
                execution time

```
The output lists the provider, memory size, ([CommonOptions.mode](./faastjs.commonoptions.mode.md)<!-- -->), average time of a single execution of the workload, the standard deviation (in seconds) of the execution time, and average estimated cost for a single run of the workload.

The "execution time" referenced here is not wall clock time, but rather execution time in the cloud function. The execution time does not include any time the workload spends waiting locally. If the workload invokes multiple cloud functions, their execution times will be summed even if they happen concurrently. This ensures the execution time and cost are aligned.

