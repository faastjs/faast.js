# Faast

The `faast` function is the main interface:

```typescript
function faast(provider, module, moduleFile, options): Promise<FaastModule>;
```

where:

- `provider` is "aws" | "google" | "local"
- `module` is the imported module containing .
- `moduleFile` is the location of the imported module. It can be specified as a relative or full path to a `.js` file, optionally omitting the extension. In general you can pass the same string as you pass to `require` or `import`. Using the output of `require.resolve` for the module also works.
- `options` are the possible [options](#Options). This argument is not required.

The return value is a promise for an instance of `FaastModule`.

## Calling Cloud Functions

The `functions` property on `FaastModule` contains the same functions as `module`, except they return promises.

For example:

```typescript
// functions.ts
export function add(a: number, b: number) {
 return a + b;
}
```

```typescript
import { faast } from "faast";
import * as funcs from "./functions";

async function main() {
 const cloudModule = await faast("aws", funcs, "./functions");
 try {
  const remote = cloudModule.functions;
  console.log(await remote.add(23, 19));
 } finally {
  await cloudModule.cleanup();
 }
}

main();
```

### Terminology

**Provider**: A Functions as a Service (FaaS) provider, such as AWS Lambda or
Google Cloud Functions. Faast.js also has a "local" provider which uses child
processes to simulate a FaaS service without cloud usage.

**faast.js module**, also known as **faast module**: A wrapper around an
ordinary JavaScript/TypeScript module that transforms exported ordinary
functions into cloud functions. A faast.js module corresponds to a single AWS
Lambda or Google Cloud Function that multiplexes requests to all of the
functions exported by the module.

**Cloud function**: A function within a faast.js module instantiated on a
provider.

### Functions must be idempotent

Functions you invoke with faast.js must be idempotent. That is, it should be possible to execute them more than once (including concurrently!) and still get the same result without causing any undesirable side effects. This is because faast.js or the cloud provider might invoke your function more than once, usually to retry transient errors that are inherent in large scale distributed systems. Faast.js may also issue redundant requests to try to reduce [tail latency][https://blog.acolyer.org/2015/01/15/the-tail-at-scale/].

### Handling errors

- Faast errors
- Provider errors
- User errors

## Cleanup

Always invoke `cleanup` to remove cloud resources created by faast.js. It is advisable to do this within a `finally` block to ensure this gets invoked in case of exceptions.

If your application crashes while executing, then cleanup won't get done. In this case, faast.js has automatic [garbage collection](./02-options#Garbage-Collection) that will delete resources after a period of time (1 day by default, for most resources).

## Logs

Logs are not downloaded by default; they are preserved in the cloud provider's logging service (e.g. Cloudwatch Logs for AWS Stackdriver Logs for GCP, and a local temporary directory for local mode). Access logs via the `logUrl` method:

```typescript
console.log(`Log URL: ${cloudModule.logUrl()}`);
```

The main reason for this design is (1) downloading logs causes outbound data transfer, which can be expensive (2) cloud providers have specialized filtering and querying that works well for the cloud-specific metadata they add to log entries, and (3) log services are specifically designed to handle the output of thousands of concurrent log streams.

Faast.js ensures logs will expire; on AWS the log group expiration is set to 1 day. On GCP the default log expiration is 30 days. On local mode, logs are cleaned up the later of 1 day or the next time a faast.js process executes.

When errors are thrown by faast.js functions, log URLs may be appended to the error message. Whenever possible, these URLs incorporate cloud-specific filtering parameters to focus the log output to just the failed execution.

## Options

```typescript
 /**
  * If true, create a child process to execute the wrapped module's functions.
  */
 childProcess?: boolean;
 addDirectory?: string | string[];
 addZipFile?: string | string[];
 packageJson?: string | object | false;
 webpackOptions?: webpack.Configuration;
 concurrency?: number;
 gc?: boolean;
 maxRetries?: number;
 memorySize?: number;
 mode?: "https" | "queue" | "auto";
 retentionInDays?: number;
 speculativeRetryThreshold?: number;
 timeout?: number;
```

In addition to these options, each cloud provider has cloud-specific options. See [aws](./04-aws-lambda#Options), [google](./05-google-cloud-functions#Options), or [local](./06-local#Options) for details.

## Bundling, dependencies, and package.json

Providers may have code size limits. For AWS, the code size limit is 50MB when
uploaded directly. If you have a large directory, consider creating a
[Lambda Layer](https://us-west-2.console.aws.amazon.com/lambda/home?#/layers)
and add it to [AwsOptions.awsLambdaOptions](api/faastjs.awsoptions.awslambdaoptions.md) under the `Layers` property.
This increases the maximum size to 250MB.

Faast.js automatically creates layers for when `packageJson` is used.

Up to 500MB may also be put into temp space. This would need to be manually uploaded to S3 and

## FAAST_PACKAGE_DIR

Set this environment variable to a directory and faast.js will place the code
bundle zip files it creates for each function in the directory.
