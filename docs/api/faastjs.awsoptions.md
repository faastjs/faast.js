---
id: faastjs.awsoptions
title: AwsOptions interface
hide_title: true
---
<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[faastjs](./faastjs.md) &gt; [AwsOptions](./faastjs.awsoptions.md)

## AwsOptions interface

AWS-specific options for [faastAws()](./faastjs.faastaws.md)<!-- -->.

**Signature:**

```typescript
export interface AwsOptions extends CommonOptions 
```
**Extends:** [CommonOptions](./faastjs.commonoptions.md)

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [awsClientFactory?](./faastjs.awsoptions.awsclientfactory.md) |  | [AwsClientFactory](./faastjs.awsclientfactory.md) | _(Optional)_ AWS service factories. See [AwsClientFactory](./faastjs.awsclientfactory.md)<!-- -->. |
|  [awsLambdaOptions?](./faastjs.awsoptions.awslambdaoptions.md) |  | Partial&lt;CreateFunctionRequest&gt; | _(Optional)_ Additional options to pass to AWS Lambda creation. See [CreateFunction](https://docs.aws.amazon.com/lambda/latest/dg/API_CreateFunction.html)<!-- -->. |
|  [region?](./faastjs.awsoptions.region.md) |  | [AwsRegion](./faastjs.awsregion.md) | _(Optional)_ The region to create resources in. Garbage collection is also limited to this region. Default: <code>&quot;us-west-2&quot;</code>. |
|  [RoleName?](./faastjs.awsoptions.rolename.md) |  | string | _(Optional)_ The role that the lambda function will assume when executing user code. Default: <code>&quot;faast-cached-lambda-role&quot;</code>. Rarely used. |
