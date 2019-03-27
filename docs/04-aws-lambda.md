---
id: aws-lambda
title: Running faast.js on AWS Lambda
---

Using the `faast` function works well with AWS, but the [`faastAws`](./api/faastjs.faastaws.md) function allows you to specify more specific [`AwsOptions`](./api/faastjs.awsoptions.md).

The most likely reason to use `faastAws` is to specify the region:

```typescript
faastAws(m, "/path", { region: "us-east-1" });
```

## Logs

AWS requires a new Cloudwatch log group to be created for each lambda function. So you're likely to see many log groups created when using faast.js. These log groups have their log streams expire automatically after 24h, and empty log groups are removed by garbage collection the next time faast.js garbage collection runs.

## Dependencies and Packaging

xxx

## Queue vs Https mode

xxx

## Garbage collection

Faast.js resources matching the name `faast-${uuid}`, specifically:

`/faast-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89aAbB][a-f0-9]{3}-[a-f0-9]{12}/`;

If you want to eliminate any chance that faast.js accidentally removes resources that conflict with these names, use faast.js within a separate account.

## IAM Roles

Faast.js will create an IAM role `faast-cached-lambda-role` for the lambda function it creates. By default this role will have administrator access. The role will be created dynamically and will remain in your account cached even after cleanup function is called.

If you remove this role, it will be created again the next time faast.js runs.
