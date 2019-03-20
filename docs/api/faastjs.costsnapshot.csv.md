[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CostSnapshot](./faastjs.costsnapshot.md) &gt; [csv](./faastjs.costsnapshot.csv.md)

## CostSnapshot.csv() method

Comma separated value output for a cost snapshot.

<b>Signature:</b>

```typescript
csv(): string;
```
<b>Returns:</b>

`string`

## Remarks

The format is "metric,unit,pricing,measured,cost,percentage,comment".

Example output:

```
metric,unit,pricing,measured,cost,percentage,comment
functionCallDuration,second,0.00002813,0.60000000,0.00001688,64.1% ,"https://aws.amazon.com/lambda/pricing (rate = 0.00001667/(GB*second) * 1.6875 GB = 0.00002813/second)"
functionCallRequests,request,0.00000020,5,0.00000100,3.8% ,"https://aws.amazon.com/lambda/pricing"
outboundDataTransfer,GB,0.09000000,0.00000844,0.00000076,2.9% ,"https://aws.amazon.com/ec2/pricing/on-demand/#Data_Transfer"
sqs,request,0.00000040,13,0.00000520,19.7% ,"https://aws.amazon.com/sqs/pricing"
sns,request,0.00000050,5,0.00000250,9.5% ,"https://aws.amazon.com/sns/pricing"
logIngestion,GB,0.50000000,0,0,0.0% ,"https://aws.amazon.com/cloudwatch/pricing/ - Log ingestion costs not currently included."

```

