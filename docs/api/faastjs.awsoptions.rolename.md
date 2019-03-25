---
id: faastjs.awsoptions.rolename
title: AwsOptions.RoleName property
hide_title: true
---
[faastjs](./faastjs.md) &gt; [AwsOptions](./faastjs.awsoptions.md) &gt; [RoleName](./faastjs.awsoptions.rolename.md)

## AwsOptions.RoleName property

The role that the lambda function will assume when executing user code. Default: `"faast-cached-lambda-role"`<!-- -->. Rarely used.

<b>Signature:</b>

```typescript
RoleName?: string;
```

## Remarks

When a lambda executes, it first assumes an [execution role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html) to grant access to resources.

By default, faast.js creates this execution role for you and leaves it permanently in your account (the role is shared across all lambda functions created by faast.js). By default, faast.js grants administrator privileges to this role so your code can perform any AWS operation it requires.

You can [create a custom role](https://console.aws.amazon.com/iam/home#/roles) that specifies more limited permissions if you prefer not to grant administrator privileges. Any role you assign for faast.js modules needs at least the following permissions:

- Execution Role:

```json
  {
      "Version": "2012-10-17",
      "Statement": [
          {
              "Effect": "Allow",
              "Action": ["logs:*"],
              "Resource": "arn:aws:logs:*:*:log-group:faast-*"
          },
          {
              "Effect": "Allow",
              "Action": ["sqs:*"],
              "Resource": "arn:aws:sqs:*:*:faast-*"
          }
      ]
  }

```
- Trust relationship (also known as `AssumeRolePolicyDocument` in the AWS SDK):

```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Service": "lambda.amazonaws.com"
        },
        "Action": "sts:AssumeRole"
      }
    ]
  }

```
