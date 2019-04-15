---
id: introduction
title: Introduction
hide_title: true
---

# Introduction

## Installation

Faast.js requires node version 8+.

```shell
$ npm install faastjs
```

## Setting up cloud providers

Using the local provider allows you to test faast.js on your local machine. There is no setup, just use `"local"` as the name of the provider.

AWS is recommended for optimal faast.js performance. See [AWS setup instructions](./04-aws.md#setup).

Google Cloud is also supported. See [Google Cloud setup instructions](./05-google-cloud.md#setup).

## Usage

Cloud functions can be written as ordinary TypeScript or JavaScript modules:

```typescript
// functions.ts
export function hello(name: string) {
    return "hello " + name + "!";
}
```

The `faast` function transforms ordinary modules into faast.js modules. This means the `functions` property will contain proxies for all of the functions from the original module, modified to return a `Promise`:

```typescript
// example.ts
import { faast } from "faastjs";
import * as funcs from "./functions";

(async () => {
    const m = await faast("aws", funcs, "./functions");
    try {
        // m.functions.hello: string => Promise<string>
        const result = await m.functions.hello("world");
        console.log(result);
    } finally {
        await m.cleanup();
    }
})();
```

With TypeScript you get autocomplete on `functions` and type checking on arguments and return values.

Functions need to be [idempotent](https://stackoverflow.com/questions/1077412/what-is-an-idempotent-operation) because they might be invoked multiple times, either by Faast.js or by the cloud provider (or both).

## Scaling up

It's easy to start many concurrent calls; just use standard asynchronous programming techniques. Here's an example that invokes 1000 calls in parallel and waits for completion with `Promise.all`:

```typescript
import { faast } from "faastjs";
import * as funcs from "./functions";

(async () => {
    const m = await faast("aws", funcs, "./functions");
    const promises = [];
    // Invoke m.functions.hello() 1000 times in parallel.
    for (let i = 0; i < 1000; i++) {
        promises.push(m.functions.hello("world " + i));
    }
    // Wait for all 1000 calls to complete.
    const results = await Promise.all(promises);
    await m.cleanup();
    console.log(results);
})();
```

## Options

Try out different providers:

```typescript
await faast("aws", ...)
await faast("google", ...)
await faast("local", ...)
```

Modify the amount of memory allocated to the function, timeout, and maximum concurrency:

```typescript
await faast("aws", funcs, "./functions", {
    memorySize: 1024,
    timeout: 60,
    concurrency: 250
});
```

Add a local directory or zipfile (which will be unzipped on the remote side) to the code package:

```typescript
await faast("aws", funcs, "./functions", {
    addDirectory: "path/to/directory",
    addZipFile: "path/to/file.zip"
});
```

### Package Dependencies

In most use cases you won't need to specify dependencies explicitly because faast.js uses webpack to automatically bundle dependencies for you. But if your bundle exceeds 50MB or has native dependencies, you'll need to specify [`packageJson`](./api/faastjs.commonoptions.packagejson.md). Faast.js even installs and caches dependencies in a Lambda Layer for you on AWS!

```typescript
await faast("aws", funcs, "./functions", {
    // packageJson can be an object or a file path
    packageJson: {
        dependencies: {
            sharp: "latest"
        }
    }
});
```

Read more about [package dependencies on AWS](./04-aws.md#package-dependencies) and [package dependencies on Google Cloud](./05-google-cloud.md#package-dependencies).

Check out even more options in [CommonOptions](./api/faastjs.commonoptions.md) and cloud-specific options in [AwsOptions](./api/faastjs.awsoptions.md), [GoogleOptions](./api/faastjs.googleoptions.md), and [LocalOptions](./api/faastjs.localoptions.md).

## Terminology

**Provider**: A Functions as a Service (FaaS) provider, such as AWS Lambda or Google Cloud Functions. Faast.js also has a "local" provider which uses child processes to simulate a FaaS service without cloud usage.

**faast.js module**, also known as **faast module**: A wrapper around an ordinary JavaScript/TypeScript module that transforms exported ordinary functions into cloud functions. A faast.js module corresponds to a single AWS Lambda or Google Cloud Function that multiplexes requests to all of the functions exported by the module.

**Cloud function** or **remote function**: A function within a faast.js module instantiated on a provider.

**Proxy function** or **local function**: The local function that forwards invocations to the remote cloud function. Proxy functions are accessed via `faastModule.functions.*`.

## Functions must be idempotent

Functions you invoke with faast.js must be idempotent. That is, it should be possible to execute them more than once (including concurrently) and still get the same result without causing any undesirable side effects. This is because faast.js or the cloud provider might invoke your function more than once, usually to retry transient errors that are inherent in large scale distributed systems. Faast.js may also issue redundant requests that are still executing to try to reduce [tail latency][https://blog.acolyer.org/2015/01/15/the-tail-at-scale/].

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

## faastjs command line tool

Garbage collection should take care of stray faast.js resources automatically. But if you really want to remove all traces of faast.js from your account, we also have a command line script.

Usage:

```shell
$ npx faastjs cleanup aws
```

```shell
$ npx faastjs cleanup google
```

Example output:

```text
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

```shell
$ npx faastjs cleanup aws -x
```

This will prompt to confirm.

### Local caching

Faast.js creates some local cache files in `~/.faast`, with a subdirectory for each provider used. The `faastjs cleanup` command will delete these files for you.
