---
id: introduction
title: Introduction
hide_title: true
---

# Introduction

## Installation

Faast.js requires node version 8+.

```bash
$ npm install faastjs
```

## Setting up cloud providers

Using the local provider allows you to test faast.js on your local machine. See [local provider instructions](./06-local.md).

AWS is recommended for optimal faast.js performance. See [AWS setup instructions](./04-aws-lambda#setup).

Google Cloud is also fully supported. See [Google Cloud setup instructions](./05-google-cloud-functions#setup).

## Usage

Cloud functions can be written as ordinary TypeScript or JavaScript modules:

```typescript
// functions.ts
export function hello(name: string) {
 return "hello " + name + "!";
}
```

The `faast` function to create faast.js modules:

```typescript
// example.ts
import { faast } from "faastjs";
import * as funcs from "./functions";
...
const faastModule = await faast("aws", funcs, "./functions");
const remote = faastModule.functions;
console.log(await remote.hello("world"));
```

Functions need to be [idempotent][] because they might be invoked multiple times, either by Faast.js or by the cloud provider (or both).

## Options

Try out different providers:

```typescript
faast("aws", ...)
faast("google", ...)
faast("local", ...)
```

Modify the amount of memory allocated to the function, timeout, and maximum concurrency:

```typescript
faast("aws", m, "./module", {
 memorySize: 1024,
 timeout: 60,
 concurrency: 250
});
```

Add a local directory or zipfile (which will be unzipped on the remote side) to the code package:

```typescript
faast("aws", m, "./module", {
 addDirectory: "path/to/directory",
 addZipFile: "path/to/file.zip"
});
```

In most use cases you won't need to specify dependencies explicitly because faast.js uses webpack to automatically bundle dependencies for you. But if your bundle exceeds 50MB or has native dependencies, you'll need to specify [`packageJson`](./api/faastjs.commonoptions.packagejson.md). Faast.js even installs and caches dependencies in a Lambda Layer for you on AWS!

```typescript
faast("aws", m, "./module", {
 // Can alternatively specify a file path for packageJson
 packageJson: {
  dependencies: {
   tslib: "^1.9.1"
  }
 }
});
```

Read more about [package dependencies on AWS](./04-aws-lambda#package-dependencies) and [package dependencies on Google Cloud](./05-google-cloud-functions#package-dependencies).

Check out even more options in [CommonOptions](./api/faastjs.commonoptions.md) and cloud-specific options in [AwsOptions](./api/faastjs.awsoptions.md), [GoogleOptions](./api/faastjs.googleoptions.md), and [LocalOptions](./api/faastjs.localoptions.md).

## Cleaning up stray resources

If you don't want to wait for 24h for garbage collection to clean up faast.js created cloud resources, you can use the command line tool `faastjs` to manually remove all vestiges of faast.js from your account:

```
$ npx faastjs cleanup aws
```

By default the utility runs in dry-run mode, only printing the actions it will perform. To actually execute the cleanup, specify the `-x` option:

```
$ npx faastjs cleanup aws -x
```

## Calling Cloud Functions

The `functions` property on `FaastModule` contains the same functions as `module`, except they return promises.

For example:

```typescript
// functions.ts
export function add(a: number, b: number) {
 return a + b;
}
```

Transform this into a faast.js module:

```typescript
import { faast } from "faast";
import * as funcs from "./functions";

(async () => {
 const faastModule = await faast("aws", funcs, "./functions");
 try {
  const remote = faastModule.functions;
  console.log(await remote.add(23, 19));
 } finally {
  await faastModule.cleanup();
 }
})();
```

### Terminology

**Provider**: A Functions as a Service (FaaS) provider, such as AWS Lambda or Google Cloud Functions. Faast.js also has a "local" provider which uses child processes to simulate a FaaS service without cloud usage.

**faast.js module**, also known as **faast module**: A wrapper around an ordinary JavaScript/TypeScript module that transforms exported ordinary functions into cloud functions. A faast.js module corresponds to a single AWS Lambda or Google Cloud Function that multiplexes requests to all of the functions exported by the module.

**Cloud function** or **remote function**: A function within a faast.js module instantiated on a provider.

**Proxy function** or **local function**: The local function that forwards invocations to the remote cloud function. Proxy functions are accessed via `faastModule.functions.*`.

### Functions must be idempotent

Functions you invoke with faast.js must be idempotent. That is, it should be possible to execute them more than once (including concurrently!) and still get the same result without causing any undesirable side effects. This is because faast.js or the cloud provider might invoke your function more than once, usually to retry transient errors that are inherent in large scale distributed systems. Faast.js may also issue redundant requests that are still executing to try to reduce [tail latency][https://blog.acolyer.org/2015/01/15/the-tail-at-scale/].

## Ephemeral Infrastructure

Every call to `faast` creates its own cloud infrastructure. For example, on AWS this creates an AWS Lambda function, SNS topic, topic subscription, SQS queue, and log group.

## Cleanup

The [cleanup](./api/faastjs.faastmodule.cleanup.md) function removes the infrastructure for a faast.js instance immediately. It is recommended that you always call `cleanup` in a `finally` block to minimize the infrastructure left behind on your cloud console. Here is a more complete code example with cleanup:

```typescript
import { faast } from "faastjs";
import * as funcs from "./functions";

(async () => {
 const faastModule = await faast("aws", funcs, "./functions");
 try {
  const remote = faastModule.functions;
  console.log(await remote.hello("world"));
 } finally {
  await faastModule.cleanup();
 }
})();
```

## Garbage collection

Some resources, such as logs, are deliberately not deleted in the `cleanup` function. If your program crashes or forgets to call `cleanup`, then infrastructure resources may be left behind. The goal of garbage collection is to ensure that these faast resources are properly disposed of, so you never need to perform an explicit action to keep your account infrastructure "clean" and within the resource limits that your cloud provider sets. By default, faast.js removes resources from prior faast.js instances after they age beyond 24 hours.

Faast.js resources match the name `faast-${uuid}`, specifically:

`/faast-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89aAbB][a-f0-9]{3}-[a-f0-9]{12}/`;

If you want to eliminate any chance that faast.js accidentally removes resources that conflict with these names, use faast.js within a separate account.

Garbage collection is controlled by the [gc](./api/faastjs.commonoptions.gc.md) option.

## Handling errors

Error can occur at multiple points: in your cloud function code, in the cloud provider, or in faast.js itself. All of these are treated uniformly by faast.js when indicating an error to your code.

If a cloud function throws an exception or rejects its promise, then the local proxy will reject. If the cloud function throws or rejects a non-Error that can be accurately serialized by `JSON.stringify` (e.g. a string, number, or `undefined`) then the local proxy also rejects with this value.

If the cloud function rejects with an instance of `Error`, then the proxy rejects with a [`FaastError`](./api/faastjs.faasterror.md). The `FaastError` will contain all of the properties originally on the `Error` thrown in the remote cloud function such as `message` and `stack`. If available, the `FaastError` will also contain a `logUrl` property that provides a link to the specific cloud function invocation that caused the error.

## Logs

Logs are not downloaded by default; they are preserved in the cloud provider's logging service (e.g. Cloudwatch Logs for AWS Stackdriver Logs for GCP, and a local temporary directory for local mode). Access logs via the `logUrl` method:

```typescript
console.log(`Log URL: ${faastModule.logUrl()}`);
```

The main reason for this design is (1) downloading logs causes outbound data transfer, which can be expensive (2) cloud providers have specialized filtering and querying that works well for the cloud-specific metadata they add to log entries, and (3) log services are specifically designed to handle the output of thousands of concurrent log streams.

Faast.js ensures logs will expire; on AWS the log group expiration is set to 1 day. On GCP the default log expiration is 30 days. On local mode, logs are cleaned up the later of 1 day or the next time a faast.js process executes.

When errors are thrown by faast.js functions, log URLs may be appended to the error message. Whenever possible, these URLs incorporate cloud-specific filtering parameters to focus the log output to just the failed execution.

## Local caching in ~/.faast

Faast.js will create some local cache files in `~/.faast`, with a subdirectory for each provider used. The [`faastjs cleanup`](../README#Cleaning_up_stray_resources) command will delete these files for you. Or, you can clear the local cache by deleting `~/.faast` manually. No configuration is stored there, only caching files.

[idempotent]: https://stackoverflow.com/questions/1077412/what-is-an-idempotent-operation

## Command line tool

Faast.js contains a command line tool but unlike other platforms, it should be seldomly used. Its main purpose currently is to clean up infrastructure if you want to remove all traces of faast.js from your account.

### Cleanup command

Usage:

```
$ npx faastjs cleanup aws
$ npx faastjs cleanup google
```

Example output:

```
Region: us-west-2
SNS subscriptions
  arn:aws:sns:us-west-2:343675226624:faast-8e126ec5-1105-46da-b81e-03c50a55ff20-Requests:3fa4b55c-4661-4858-ace5-6fcb8b9a07ed
SNS topics
  arn:aws:sns:us-west-2:343675226624:faast-5da3a85a-b870-48d4-b196-2b271ab82a12-Requests
SQS queues
  https://sqs.us-west-2.amazonaws.com/343675226624/faast-07ad24d5-ed03-4b1f-9514-e398882d86ff-Responses
Lambda functions
  faast-ed5f0141-cde6-4049-8d9c-5d215c956428
IAM roles
  faast-cached-lambda-role
Lambda layers
Persistent cache: /Users/achou/.faastjs/aws/pricing
  cache entries: 12
Persistent cache: /Users/achou/.faastjs/google/pricing
  cache entries: 5
Persistent cache: /Users/achou/.faastjs/aws/gc
  cache entries: 1
Cloudwatch log groups
  /aws/lambda/faast-01ade377-1ed9-4b2a-bf26-e2aa92a5305d
  /aws/lambda/faast-0459e25e-ec88-4e8b-9002-84ca765e8006
(dryrun mode, no resources will be deleted, specify -x to execute cleanup)
```

By default, the cleanup command will print out resource names, but not delete anything. To actually delete resources, add the `-x` option:

```
npx faastjs cleanup aws -x
```

This will prompt to confirm.
