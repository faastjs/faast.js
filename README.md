[![CircleCI](https://circleci.com/gh/acchou/faast.js.svg?style=shield&circle-token=c97f196a78c7173d6ca4e5fc9f09c2cba4ab0647)](https://circleci.com/gh/acchou/faast.js) [![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Facchou%2Ffaast.js.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Facchou%2Ffaast.js?ref=badge_shield)

# Faast.js

Faast.js turns JavaScript modules into scalable serverless functions for batch processing.

- **Scalable:** Use serverless functions to scale your batch jobs up to thousands of cores.
- **Cost-effective:** Understand and optimize your workload costs in real time. Pay only for compute time actually used.
- **Ephemeral:** No cluster management. No container management. Faast.js is designed have zero ops management burden.
- **Developer optimized:** Includes first class support for TypeScript and JavaScript. Type safety, documentation, and extensive testing already included.
- **Portable:** Built-in support for [AWS Lambda](https://aws.amazon.com/lambda/) and [Google Cloud Functions](https://cloud.google.com/functions/), as well as [local](./docs/06-local) processing mode. Change one line of code to switch.

## Installation

```bash
$ npm install faastjs
```

## Usage

Cloud functions can be written as ordinary TypeScript modules:

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

Functions need to be [idempotent](https://stackoverflow.com/questions/1077412/what-is-an-idempotent-operation) because they might be invoked multiple times, either by Faast.js or by the cloud provider (or both).

## Ephemeral Infrastructure

Every call to `faast` creates its own cloud infrastructure. For example, on AWS this creates an AWS Lambda function, SNS topic, topic subscription, SQS queue, and log group. Faast.js contains a garbage collector that runs asynchronously with your process to clean up old infrastructure from previous instances.

There is also a `cleanup` function which cleans up the infrastructure for the faast.js instance immediately. It is recommended that you always call `cleanup` to minimize the infrastructure left behind on your cloud console. Here is a more complete code example with cleanup:

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

Add a local directory or zipfile (which will be unzipped on the remote side) to
the code package:

```typescript
faast("aws", m, "./module", {
 addDirectory: "path/to/directory",
 addZipFile: "path/to/file.zip"
});
```

In most use cases you won't need to specify dependencies explicitly because
faast.js uses webpack to automatically bundle dependencies for you. But if your
bundle exceeds 50MB or has native dependencies, you'll need to specify
`packageJson`. Faast.js even [installs and caches dependencies in a Lambda
Layer](./api/faastjs.commonoptions.packagejson.md) for you on AWS!

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

Check out even more options in the [CommonOptions
interface](./api/faastjs.commonoptions.md) and cloud-specific options in
[AwsOptions](./api/faastjs.awsoptions.md),
[GoogleOptions](./api/faastjs.googleoptions.md), and
[LocalOptions](./api/faastjs.localoptions.md).

## Cost estimates

Get a cost estimate for your workload:

```typescript
const faastModule = await faast("aws", m, "./path/to/module");
try {
 // invoke cloud functions on faastModule.functions.*
} finally {
 await faastModule.cleanup();
 const costSnapshot = await faastModule.costSnapshot();
 console.log(costSnapshot);
}
```

Example cost estimate output:

```
functionCallDuration  $0.00002813/second            0.6 second     $0.00001688    68.4%  [1]
sqs                   $0.00000040/request             9 requests   $0.00000360    14.6%  [2]
sns                   $0.00000050/request             5 requests   $0.00000250    10.1%  [3]
functionCallRequests  $0.00000020/request             5 requests   $0.00000100     4.1%  [4]
outboundDataTransfer  $0.09000000/GB         0.00000769 GB         $0.00000069     2.8%  [5]
logIngestion          $0.50000000/GB                  0 GB         $0              0.0%  [6]
---------------------------------------------------------------------------------------
                                                                   $0.00002467 (USD)

  * Estimated using highest pricing tier for each service. Limitations apply.
 ** Does not account for free tier.
[1]: https://aws.amazon.com/lambda/pricing (rate = 0.00001667/(GB*second) * 1.6875 GB = 0.00002813/second)
[2]: https://aws.amazon.com/sqs/pricing
[3]: https://aws.amazon.com/sns/pricing
[4]: https://aws.amazon.com/lambda/pricing
[5]: https://aws.amazon.com/ec2/pricing/on-demand/#Data_Transfer
[6]: https://aws.amazon.com/cloudwatch/pricing/ - Log ingestion costs not currently included.
```

Check out more

## Setting up cloud providers

Using faast.js currently requires an IAM account or service account with
administrator / owner privileges.

### GCP

Setup credentials for [GCP](https://cloud.google.com/sdk/docs/authorizing)

- Create a project
- Create a google [service
  account](https://console.cloud.google.com/iam-admin/serviceaccounts)
- Assign Owner permissions for the service account
- Enable Cloud functions API
- Run basic Google test

```
npx ava -m="*google*" build/test/basic.test.js
```

### AWS

Setup credentials for
[AWS](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html).

- Add credentials to system using aws cli (`aws configure`)
- Ensure AWS user has AdministratorAccess role and Administrator group
- Run basic AWS test

```
npx ava -m="*aws*" build/test/basic.test.js
```

### Local

Using the `"local"` provider allows you to test faast.js on your local machine.
Each invocation starts a new process, up to the [concurrency
limit](./docs/api/faastjs.commonoptions.concurrency.md). Processes are reused
for subsequent calls just as they are in a real cloud function, allows you to
test caching strategies.

## Development workflow

Suggest doing local, then small scale with cloud provider, then large scale.

# Principles

- Ephemeral functions: Faast.js cleans up after itself. It removes functions,
  roles, logs, and log groups. By default it will leave no trace in your
  infrastructure once cleanup is completed.
- Avoids resource exhaustion: doesn't take up log space, function name space,
  and other limits. Only currently executing functions take up infrastructure
  namespace.
- Independence: two separate jobs can be run at the same time and they will not
  interfere with each other.
- Works with AWS and Google Cloud Platform.

# Cleaning up stray resources

Use the `cleanup` utility to clean up stray resources that may be left by
Faast.js in some rare instances (e.g. crashes where cleanup is not invoked):

```
$ node build/src/cleanup.js aws
```

By default the utility runs in dry-run mode, only printing the actions it will
perform. To actually execute the cleanup, specify the `-x` option:

```
$ node build/src/cleanup.js aws -x
```

## Local caching in ~/.faast

Faast.js will create some local cache files in `~/.faast`, with a subdirectory
for each provider used. `cleanup` will delete these files for you. Or, you can
clear the local cache by deleting `~/.faast` manually. No configuration is
stored there, only caching files.

## Cache anomalies

Faast.js will only cache packages when `packageJson` is specified. The key to
the hash is the sha256 hash of the contents of your `package.json`.

Faast.js cache entries expire 24 hours after they are created (they may not be
deleted immediately, but they are not used). this helps ensure that cached
packages do not get too out of date.

# Concurrency

Response queue funnel: create a request listener for every 20 outstanding
requests. With a minimum of 2.

# Limitations

Cloudified function arguments must be serializable with
[`JSON.stringify`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify).
Faast.js will print a warning if it detects a case where `JSON.stringify` will
result in a loss of information passed to the function. This may cause
unexpected behavior when the code in the lambda function executes. For example,
the following will lose information:

- Promises are transformed into `{}`
- `Date` instances are transformed into strings
- ... and more. The MDN documentation contains more details about specific
  cases.

Faast.js tries its best to detect these cases, but 100% detection is not guaranteed.

## Contributing

See [contributing](./docs/11-contributing)
