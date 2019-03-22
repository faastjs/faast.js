[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [AwsOptions](./faastjs.awsoptions.md)

## AwsOptions interface

AWS-specific options. Extends [CommonOptions](./faastjs.commonoptions.md)<!-- -->. These options should be used with [faastAws()](./faastjs.faastaws.md)<!-- -->.

<b>Signature:</b>

```typescript
export interface AwsOptions extends CommonOptions 
```

## Properties

|  Property | Type | Description |
|  --- | --- | --- |
|  [awsLambdaOptions](./faastjs.awsoptions.awslambdaoptions.md) | `Partial<aws.Lambda.CreateFunctionRequest>` | Additional options to pass to AWS Lambda creation. |
|  [region](./faastjs.awsoptions.region.md) | `AwsRegion` | The region to create resources in. Garbage collection is also limited to this region. Default: `"us-west-2"`<!-- -->. |
|  [RoleName](./faastjs.awsoptions.rolename.md) | `string` | The role that the lambda function will assume when executing user code. Default: `"faast-cached-lambda-role"`<!-- -->. Rarely used. |

