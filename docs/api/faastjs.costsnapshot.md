---
id: faastjs.costsnapshot
title: CostSnapshot class
hide_title: true
---
[faastjs](./faastjs.md) &gt; [CostSnapshot](./faastjs.costsnapshot.md)

## CostSnapshot class

A summary of the costs incurred by a faast.js module at a point in time. Output of [FaastModule.costSnapshot()](./faastjs.faastmodule.costsnapshot.md)<!-- -->.

<b>Signature:</b>

```typescript
export declare class CostSnapshot 
```

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [costMetrics](./faastjs.costsnapshot.costmetrics.md) |  | <code>CostMetric[]</code> | The cost metric components for this cost snapshot. See [CostMetric](./faastjs.costmetric.md)<!-- -->. |
|  [options](./faastjs.costsnapshot.options.md) |  | <code>CommonOptions &#124; AwsOptions &#124; GoogleOptions</code> | The options used to initialize the faast.js module where this cost snapshot was generated. |
|  [provider](./faastjs.costsnapshot.provider.md) |  | <code>string</code> |  |
|  [stats](./faastjs.costsnapshot.stats.md) |  | <code>FunctionStats</code> | The function statistics that were used to compute prices. |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [csv()](./faastjs.costsnapshot.csv.md) |  | Comma separated value output for a cost snapshot. |
|  [find(name)](./faastjs.costsnapshot.find.md) |  |  |
|  [toString()](./faastjs.costsnapshot.tostring.md) |  | A summary of all cost metrics and prices in this cost snapshot. |
|  [total()](./faastjs.costsnapshot.total.md) |  | Sum of cost metrics. |

## Remarks

Cost information provided by faast.js is an estimate. It is derived from internal faast.js measurements and not by consulting data provided by your cloud provider.

\*\*Faast.js does not guarantee the accuracy of cost estimates.\*\*

\*\*Use at your own risk.\*\*

Example using AWS:

```typescript
const faastModule = await faast("aws", m, "./functions");
try {
    // Invoke faastModule.functions.*
} finally {
    await faastModule.cleanup();
    console.log(`Cost estimate:`);
    console.log(`${await faastModule.costSnapshot()}`);
}

```
AWS example output:

```
Cost estimate:
functionCallDuration  $0.00002813/second            0.6 second     $0.00001688    68.4%  [1]
sqs                   $0.00000040/request             9 requests   $0.00000360    14.6%  [2]
sns                   $0.00000050/request             5 requests   $0.00000250    10.1%  [3]
functionCallRequests  $0.00000020/request             5 requests   $0.00000100     4.1%  [4]
outboundDataTransfer  $0.09000000/GB         0.00000769 GB         $0.00000069     2.8%  [5]
logIngestion          $0.50000000/GB                  0 GB         $0              0.0%  [6]
---------------------------------------------------------------------------------------
                                                                   $0.00002467 (USD)

  * Estimated using highest pricing tier for each service. Limitations apply.
 ** Does not account for free tier.
[1]: https://aws.amazon.com/lambda/pricing (rate = 0.00001667/(GB*second) * 1.6875 GB = 0.00002813/second)
[2]: https://aws.amazon.com/sqs/pricing
[3]: https://aws.amazon.com/sns/pricing
[4]: https://aws.amazon.com/lambda/pricing
[5]: https://aws.amazon.com/ec2/pricing/on-demand/#Data_Transfer
[6]: https://aws.amazon.com/cloudwatch/pricing/ - Log ingestion costs not currently included.

```
A cost snapshot contains several [CostMetric](./faastjs.costmetric.md) values. Each `CostMetric` summarizes one component of the overall cost of executing the functions so far. Some cost metrics are common to all faast providers, and other metrics are provider-specific. The common metrics are:

- `functionCallDuration`<!-- -->: the estimated billed CPU time (rounded to the next 100ms) consumed by completed cloud function calls. This is the metric that usually dominates cost.

- `functionCallRequests`<!-- -->: the number of invocation requests made. Most providers charge for each invocation.

Provider-specific metrics vary. For example, AWS has the following additional metrics:

- `sqs`<!-- -->: AWS Simple Queueing Service. This metric captures the number of queue requests made to insert and retrieve queued results (each 64kb chunk is counted as an additional request). SQS is used even if [CommonOptions.mode](./faastjs.commonoptions.mode.md) is not set to `"queue"`<!-- -->, because it is necessary for monitoring cloud function invocations.

- `sns`<!-- -->: AWS Simple Notification Service. SNS is used to invoke Lambda functions when [CommonOptions.mode](./faastjs.commonoptions.mode.md) is `"queue"`<!-- -->.

- `outboundDataTransfer`<!-- -->: an estimate of the network data transferred out from the cloud provider for this faast.js module. This estimate only counts data returned from cloud function invocations and infrastructure that faast.js sets up. It does not count any outbound data sent by your cloud functions that are not known to faast.js. Note that if you run faast.js on EC2 in the same region (see [AwsOptions.region](./faastjs.awsoptions.region.md)<!-- -->), then the data transfer costs will be zero (however, the cost snapshot will not include EC2 costs). Also note that if your cloud function transfers data from/to S3 buckets in the same region, there is no cost as long as that data is not returned from the function.

- `logIngestion`<!-- -->: this cost metric is always zero for AWS. It is present to remind the user that AWS charges for log data ingested by CloudWatch Logs that are not measured by faast.js. Log entries may arrive significantly after function execution completes, and there is no way for faast.js to know exactly how long to wait, therefore it does not attempt to measure this cost. In practice, if your cloud functions do not perform extensive logging on all invocations, log ingestion costs from faast.js are likely to be low or fall within the free tier.

For Google, extra metrics include `outboundDataTransfer` similar to AWS, and `pubsub`<!-- -->, which combines costs that are split into `sns` and `sqs` on AWS.

The Local provider has no extra metrics.

Prices are retrieved dynamically from AWS and Google and cached locally. Cached prices expire after 24h. For each cost metric, faast.js uses the highest price tier to compute estimated pricing.

Cost estimates do not take free tiers into account.
