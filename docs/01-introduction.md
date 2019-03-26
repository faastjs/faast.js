---
id: introduction
title: Introduction
---

## Installation

Faast.js requires node version 8+.

```bash
$ npm install faastjs
```

## Setting up cloud providers

## Local Provider

Using the `"local"` provider allows you to test faast.js on your local machine. Each invocation starts a new process, up to the [concurrency limit](./api/faastjs.commonoptions.concurrency.md). Processes are reused for subsequent calls just as they are in a real cloud function, allows you to test caching strategies.

### AWS

Setup credentials for [AWS](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html):

- If you haven't already, set up the [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/installing.html):
  ```
  pip install awscli --upgrade --user
  ```
- Create an IAM user.
- Setup an access key ID and secret access key for the IAM user.
- Add these credentials to your local machine with aws cli (`aws configure`).
- Ensure AWS user has AdministratorAccess role and Administrator group.

### Google Cloud Platform

Setup [authentication on
GCP](https://cloud.google.com/docs/authentication/getting-started).

- Create a project
- Create a google [service account](https://console.cloud.google.com/iam-admin/serviceaccounts)
- Assign Owner permissions for the service account
- Enable [Cloud functions API](https://console.cloud.google.com/functions)
- If you've checked out this repository, you can run a basic Google test (but first see [build instructions](./11-contributing#Building)):
  ```
  npx ava -m="*google*" build/test/basic.test.js
  ```

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

async function main() {
 const faastModule = await faast("aws", funcs, "./functions");
 try {
  const remote = faastModule.functions;
  console.log(await remote.add(23, 19));
 } finally {
  await faastModule.cleanup();
 }
}

main();
```

### Terminology

**Provider**: A Functions as a Service (FaaS) provider, such as AWS Lambda or Google Cloud Functions. Faast.js also has a "local" provider which uses child processes to simulate a FaaS service without cloud usage.

**faast.js module**, also known as **faast module**: A wrapper around an ordinary JavaScript/TypeScript module that transforms exported ordinary functions into cloud functions. A faast.js module corresponds to a single AWS Lambda or Google Cloud Function that multiplexes requests to all of the functions exported by the module.

**Cloud function**: A function within a faast.js module instantiated on a provider. The term "cloud function" refers to the remote function on the cloud provider, not the local proxy.

**Proxy**: A local function that sends requests to the remote cloud function.

### Functions must be idempotent

Functions you invoke with faast.js must be idempotent. That is, it should be possible to execute them more than once (including concurrently!) and still get the same result without causing any undesirable side effects. This is because faast.js or the cloud provider might invoke your function more than once, usually to retry transient errors that are inherent in large scale distributed systems. Faast.js may also issue redundant requests to try to reduce [tail latency][https://blog.acolyer.org/2015/01/15/the-tail-at-scale/].

## Ephemeral Infrastructure

Every call to `faast` creates its own cloud infrastructure. For example, on AWS this creates an AWS Lambda function, SNS topic, topic subscription, SQS queue, and log group. Faast.js contains a [garbage collector](./api/faastjs.commonoptions.gc.md) that runs asynchronously and automatically with your process to clean up old infrastructure from previous instances.

There is also a [cleanup](./api/faastjs.faastmodule.cleanup.md) function which cleans up the infrastructure for the faast.js instance immediately. It is recommended that you always call `cleanup` to minimize the infrastructure left behind on your cloud console. Here is a more complete code example with cleanup:

```typescript
import { faast } from "faastjs";
import * as funcs from "./functions";

async function main() {
 const faastModule = await faast("aws", funcs, "./functions");
 try {
  const remote = faastModule.functions;
  console.log(await remote.hello("world"));
 } finally {
  await faastModule.cleanup();
 }
}

main();
```

### Handling errors

Error can occur at multiple points: in your cloud function code, in the cloud provider, or in faast.js itself. All of these are treated uniformly by faast.js when indicating an error to your code.

If a cloud function throws an exception or rejects its promise, then the local proxy will reject. If the cloud function throws or rejects a non-Error that can be accurately serialized by `JSON.stringify` (e.g. a string, number, or `undefined`) then the local proxy also rejects with this value.

If the cloud function rejects with an instance of `Error`, then the proxy rejects with a [`FaastError`](./api/faastjs.faasterror.md). The `FaastError` will contain all of the properties originally on the `Error` thrown in the remote cloud function such as `message` and `stack`. If available, the `FaastError` will also contain a `logUrl` property that provides a link to the specific cloud function invocation that caused the error.

## Cleanup

Always invoke [`cleanup`](./api/faastjs.faastmodule.cleanup.md) to remove cloud resources created by faast.js. It is advisable to do this within a `finally` block to ensure this gets invoked in case of exceptions.

If your application crashes while executing, then cleanup won't get done. In this case, faast.js has automatic [garbage collection](./02-options#Garbage-Collection) that will delete resources after a period of time (1 day by default, for most resources).

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
