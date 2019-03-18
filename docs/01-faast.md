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

The return value is a promise for an instance of [`FaastModule`](./api/faastjs.faastmodule.md).

See the [api documentation](./api/faastjs.faast.md) for more details.

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

**Provider**: A Functions as a Service (FaaS) provider, such as AWS Lambda or
Google Cloud Functions. Faast.js also has a "local" provider which uses child
processes to simulate a FaaS service without cloud usage.

**faast.js module**, also known as **faast module**: A wrapper around an
ordinary JavaScript/TypeScript module that transforms exported ordinary
functions into cloud functions. A faast.js module corresponds to a single AWS
Lambda or Google Cloud Function that multiplexes requests to all of the
functions exported by the module.

**Cloud function**: A function within a faast.js module instantiated on a
provider. The term "cloud function" refers to the remote function on the cloud provider, not the local proxy.

**Proxy**: A local function that sends requests to the remote cloud function.

### Functions must be idempotent

Functions you invoke with faast.js must be idempotent. That is, it should be possible to execute them more than once (including concurrently!) and still get the same result without causing any undesirable side effects. This is because faast.js or the cloud provider might invoke your function more than once, usually to retry transient errors that are inherent in large scale distributed systems. Faast.js may also issue redundant requests to try to reduce [tail latency][https://blog.acolyer.org/2015/01/15/the-tail-at-scale/].

### Handling errors

Error can occur at multiple points: in your cloud function code, in the cloud provider, or in faast.js itself. All of these are treated uniformly by faast.js when indicating an error to your code.

If a cloud function throws an exception or rejects its promise, then the local
proxy will reject. If the cloud function throws or rejects a non-Error that can
be accurately serialized by `JSON.stringify` (e.g. a string, number, or
`undefined`) then the local proxy also rejects with this value.

If the cloud function rejects with an instance of `Error`, then the proxy
rejects with a [`FaastError`](./api/faastjs.faasterror.md). The `FaastError`
will contain all of the properties originally on the `Error` thrown in the
remote cloud function such as `message` and `stack`. If available, the
`FaastError` will also contain a `logUrl` property that provides a link to the
specific cloud function invocation that caused the error.

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

## Understanding code bundles with `FAAST_PACKAGE_DIR`

If the environment variable `FAAST_PACKAGE_DIR` points to a directory, faast.js
will place zip files it creates for each cloud function in the directory. These
files are helpful in understanding what faast.js actually uploads to the cloud
provider.

Note that if `packageJson` is specified, AWS Lambda Layers are not in the code
bundle but rather specified as part of instantiating the lambda function.

## Local caching in ~/.faast

Faast.js will create some local cache files in `~/.faast`, with a subdirectory
for each provider used. The [`faastjs cleanup`](../README#Cleaning_up_stray_resources) command will delete these files
for you. Or, you can clear the local cache by deleting `~/.faast` manually. No
configuration is stored there, only caching files.

## DEBUG environment variable

Turn on verbose logging by setting the `DEBUG` environment variable. For example:

```bash
$ DEBUG=faast:info node example.js
$ DEBUG=faast:* node example.js
```

These options are available:

- `faast:*` - Turn on all logging.
- `faast:info` - Basic verbose logging. Disabled by default.
- `faast:warning` - Output warnings to console.warn. Enabled by default.
- `faast:gc` - Print debugging information related to garbage collection. Disabled by default.
- `faast:leaks` - Print debugging information when a memory is potentially detected within the faast.js module. Enabled by default. See XXX.
- `faast:calls` - Print debugging information about each call to a cloud function. Disabled by default.
- `faast:webpack` - Print debugging information about webpack, used to pack up cloud function code. Disabled by default.
- `faast:provider` - Print debugging information about each interaction with cloud-provider specific code from the higher-level faast.js abstraction. Useful for debugging issues with specific cloud providers. Disabled by default.
- `faast:awssdk` - Only available for AWS, this enables aws-sdk's verbose logging output. Disabled by default.
