---
id: aws-lambda
title: AWS
---

# Running faast.js on AWS Lambda

## Options

## IAM Roles

Faast.js will create an IAM role for the lambda function it creates. By default
this role will have administrator access. The role will be created dynamically
and then cached even after cleanup function is called.
