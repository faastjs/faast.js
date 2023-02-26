---
id: faastjs.awsoptions.webpackawssdk
title: AwsOptions.webpackAwsSdk property
hide_title: true
---
<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[faastjs](./faastjs.md) &gt; [AwsOptions](./faastjs.awsoptions.md) &gt; [webpackAwsSdk](./faastjs.awsoptions.webpackawssdk.md)

## AwsOptions.webpackAwsSdk property

Use webpack to pack up the aws-sdk dependency, instead of relying on the preinstalled version on AWS Lambda. This is useful for using the node18 runtime, because it uses the aws-sdk v3, whereas faast.js currently only supports v2.

<b>Signature:</b>

```typescript
webpackAwsSdk?: boolean;
```