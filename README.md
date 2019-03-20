[![CircleCI](https://circleci.com/gh/acchou/faast.js.svg?style=shield&circle-token=c97f196a78c7173d6ca4e5fc9f09c2cba4ab0647)](https://circleci.com/gh/acchou/faast.js) [![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Facchou%2Ffaast.js.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Facchou%2Ffaast.js?ref=badge_shield)

# Faast.js

Faast.js turns JavaScript modules into scalable serverless functions for batch processing.

- **Scalable:** Use serverless functions to scale your batch jobs up to
  thousands of cores.
- **Cost-effective:** Understand and optimize your workload costs in real time.
  Pay only for compute time actually used.
- **Ephemeral:** No cluster management. No container management. Faast.js is
  designed have zero ops management burden.
- **Developer optimized:** Includes first class support for TypeScript and
  JavaScript. Type safety, documentation, and extensive testing already
  included.
- **Portable:** Built-in support for [AWS
  Lambda](https://aws.amazon.com/lambda/) and [Google Cloud
  Functions](https://cloud.google.com/functions/), as well as
  [local](./docs/06-local) processing mode. Change one line of code to switch.

## Prerequisites

Required:

- [Node](https://nodejs.org/en/download/) version 8+.

Convenient if you want to use faast.js with AWS:

- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/installing.html)
  ```
  pip install awscli --upgrade --user
  ```

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

Functions need to be [idempotent][] because they might be invoked multiple
times, either by Faast.js or by the cloud provider (or both).

## Ephemeral Infrastructure

Every call to `faast` creates its own cloud infrastructure. For example, on AWS
this creates an AWS Lambda function, SNS topic, topic subscription, SQS queue,
and log group. Faast.js contains a [garbage collector][] that runs
asynchronously and automatically with your process to clean up old
infrastructure from previous instances.

There is also a [cleanup](./docs/api/faastjs.faastmodule.cleanup.md) function
which cleans up the infrastructure for the faast.js instance immediately. It is
recommended that you always call `cleanup` to minimize the infrastructure left
behind on your cloud console. Here is a more complete code example with cleanup:

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
[`packageJson`](./docs/api/faastjs.commonoptions.packagejson.md). Faast.js even
installs and caches dependencies in a Lambda Layer for you on AWS!

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
interface](./docs/api/faastjs.commonoptions.md) and cloud-specific options in
[AwsOptions](./docs/api/faastjs.awsoptions.md),
[GoogleOptions](./docs/api/faastjs.googleoptions.md), and
[LocalOptions](./docs/api/faastjs.localoptions.md).

## Cost estimates

Get a cost estimate for your workload:

```typescript
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

Learn more about [cost snapshots](./docs/api/faastjs.costsnapshot.md).

## Cost analyzer

How much memory should you allocate to your function? More memory means a higher
price per unit time, but also faster CPU. Cost analyzer helps answer this
question by running your workload against multiple configurations, such as
differing memory sizes:

```typescript
costAnalyzer(mod, "./functions", { work });
```

Cost analyzer output:

```
  ✔ aws 128MB queue 15.385s 0.274σ $0.00003921
  ✔ aws 192MB queue 10.024s 0.230σ $0.00003576
  ✔ aws 256MB queue 8.077s 0.204σ $0.00003779
     ▲    ▲     ▲     ▲       ▲        ▲
     │    │     │     │       │        │
 provider │    mode   │     stdev     average
          │           │   execution  estimated
        memory        │     time       cost
         size         │
                execution time
```

Here's a chart showing the execution time and cost of generating 100M random
numbers at every memory size on AWS Lambda. The conclusion? You should probably
pick a memory size around 1728MB-2048MB to get the most performance at a low
cost if your workload is CPU bound. But your results may vary depending on the
particulars of your workload. Do your own experiments to verify against your
workload.

![cost-analyzer-result-aws](./docs/diagrams/cost-analyzer-graph-aws.png "cost analyzer results for AWS")

## Setting up cloud providers

Using faast.js requires an IAM account or service account with administrator /
owner privileges.

### AWS

Setup credentials for
[AWS](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html).

- Create an IAM user.
- Setup an access key ID and secret access key for the IAM user.
- Add these credentials to your local machine with aws cli (`aws configure`)
- Ensure AWS user has AdministratorAccess role and Administrator group
- If you've checked out this repository, you can a basic AWS test (but first see [build instructions](./docs/11-contributing#Building)):

```
npx ava -m="*aws*" build/test/basic.test.js
```

### Google Cloud Platform

Setup [authentication on
GCP](https://cloud.google.com/docs/authentication/getting-started).

- Create a project
- Create a google [service
  account](https://console.cloud.google.com/iam-admin/serviceaccounts)
- Assign Owner permissions for the service account
- Enable [Cloud functions API](https://console.cloud.google.com/functions)
- If you've checked out this repository, you can run a basic Google test (but first see [build instructions](./docs/11-contributing#Building)):

```
npx ava -m="*google*" build/test/basic.test.js
```

### Local Provider

Using the `"local"` provider allows you to test faast.js on your local machine.
Each invocation starts a new process, up to the [concurrency
limit](./docs/api/faastjs.commonoptions.concurrency.md). Processes are reused
for subsequent calls just as they are in a real cloud function, allows you to
test caching strategies.

## Development workflow

There's a natural way to use faast.js to maximize developer productivity:

1. Design a regular JS/TS module and export functions with arguments that are safe for `JSON.stringify`.

2. Write tests for your module and use all the great debugging tools you're used
   to, like [node
   inspector](https://nodejs.org/en/docs/guides/debugging-getting-started/),
   Chrome DevTools, and Visual Studio Code.

3. Use the `"local"` provider to test your function as a faast.js module. In
   this mode your invocations execute in local processes. Debug any issues using
   standard debugging tools you know and love. Make sure your functions are
   [idempotent][].

4. Switch from `"local"` to `"aws"` or `"google"` but limit
   [concurrency](./docs/api/faastjs.commonoptions.concurrency.md) to a low
   amount, between 1-10. Use [logUrl](./docs/api/faastjs.faastmodule.logurl.md) to review
   cloud logs of your code executing. The
   [DEBUG](./docs/01-faast#DEBUG_environment_variable) environment variable can
   be useful to see verbose output as well.

5. Next, run a sample of your workload through [cost
   analyzer](./docs/api/faastjs.costanalyzer.md) to find a good cost-performance
   tradeoff for the choice of memory size. A good default choice for CPU or
   S3-bandwidth bound workloads is between 1728MV-2048MB on AWS.

6. Gradually increase concurrency and fix any issues that arise from scaling.

Using this workflow maximizes your ability to use local debugging tools, and
confines most errors to local or small scale cloud testing. This can help avoid
costly mistakes which consume lots of procesing time on a large scale.

## Things you won't need to think about with faast.js

- Resource exhaustion: Cloud providers place limits on resources such as log
  space, number of functions, and many other resources. faast.js ensures that
  garbage is cleaned up automatically, so you don't run into cloud provider
  resource limits unexpectedly.
- Crashes and unexpected termination: Even if your code crashes, the resources
  faast.js created will be automatically cleaned up when faast.js runs next and
  at least 24h have elapsed.
- Independence: separate faast.js jobs can be run at the same time and they will
  create separate infrastructure for each faast.js module.
- Works with AWS and Google Cloud Platform.

## Cleaning up stray resources

If you don't want to wait for 24h for garbage collection to clean up faast.js
created cloud resources, you can use the command line tool `faastjs` to manually
remove all vestiges of faast.js from your account:

```
$ npx faastjs cleanup aws
```

By default the utility runs in dry-run mode, only printing the actions it will
perform. To actually execute the cleanup, specify the `-x` option:

```
$ npx faastjs cleanup aws -x
```

# Limitations

Cloudified function arguments must be serializable with
[`JSON.stringify`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify).
Faast.js will print a warning if it detects a case where `JSON.stringify` will
result in a loss of information passed to the function. This may cause
unexpected behavior when the code in the lambda function executes. For example,
the following are not supported as cloud function arguments:

- Promises arguments (however Promise return values are supported)
- `Date` arguments or return values
- Functions passed as arguments or return values
- Class instances
- ... and more. The MDN documentation contains more details about specific
  cases.

Faast.js tries its best to detect these cases, but 100% detection is not
guaranteed.

## Contributing

See [contributing](./docs/11-contributing)

## Built with

![webpack](https://raw.githubusercontent.com/webpack/media/master/logo/logo-on-white-bg.png "webpack")

[idempotent]: https://stackoverflow.com/questions/1077412/what-is-an-idempotent-operation
[garbage collector]: ./docs/api/faastjs.commonoptions.gc.md
