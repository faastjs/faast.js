[![CircleCI](https://circleci.com/gh/acchou/faast.js.svg?style=shield&circle-token=c97f196a78c7173d6ca4e5fc9f09c2cba4ab0647)](https://circleci.com/gh/acchou/faast.js) [![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Facchou%2Ffaast.js.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Facchou%2Ffaast.js?ref=badge_shield)

# Faast.js

Faast.js is a library for turning JavaScript modules into scalable serverless functions for batch processing.

- **Scalable:** Use serverless functions to scale your batch jobs up to thousands of cores.
- **Cost-effective:** Understand and optimize your workload costs in real time. Pay only for CPU time actually used.
- **Zero Ops:** No cluster management. No container management. No management. Focus on Dev, not Ops.
- **Developer optimized:** A first class developer experience including type safety. Works with TypeScript and JavaScript.
- **Portable:** Built-in support for [AWS Lambda](https://aws.amazon.com/lambda/) and [Google Cloud Functions](https://cloud.google.com/functions/), as well as local processing mode. Change one line of code to switch.

## Installation

```bash
$ npm install faast.js
```

## Usage

```typescript
// functions.ts
export function hello(name: string) {
 return "hello " + name + "!";
}

// example.ts
import * as funcs from "./functions";
async function main() {
 const lambda = await faast("aws", funcs, "./functions");
 console.log(await lambda.functions.hello("world"));
 await cloudModule.cleanup();
}
main();
```

Functions need to be [idempotent](https://stackoverflow.com/questions/1077412/what-is-an-idempotent-operation) because they might be invoked multiple times, either by Faast.js or by the cloud provider (or both).

## Verbosity options

Turn on verbose logging by setting the DEBUG environment variable. For example:

```bash
$ DEBUG=faast:info node example.js
$ DEBUG=faast:* node example.js
```

These options are available:

- faast:info - Basic verbose logging. Disabled by default.
- faast:warning - Output warnings to console.warn. Enabled by default.
- faast:gc - Print debugging information related to garbage collection. Disabled by default.
- faast:leaks - Print debugging information when a memory is potentially detected within the faast.js module. Enabled by default. See XXX.
- faast:calls - Print debugging information about each call to a cloud function. Disabled by default.
- faast:webpack - Print debugging information about webpack, used to pack up cloud function code. Disabled by default.
- faast:provider - Print debugging information about each interaction with cloud-provider specific code from the higher-level faast.js abstraction. Useful for debugging issues with specific cloud providers. Disabled by default.
- faast:awssdk - Only available for AWS, this enables aws-sdk's verbose logging output. Disabled by default.

## Memory leak detector

## Prerequisites for building:

[Node LTS](https://nodejs.org/en/download/)

[AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/installing.html)

```
pip install awscli --upgrade --user
```

npx

```
npm install -g npx
```

unzip

Available by default on MacOS and most linux distributions. Install if needed
with your local package manager. For example, on Ubuntu:

```
sudo apt install unzip
```

## Building

```
$ npm install
$ npm run build
```

## Testing live cloud services

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

### All "fast" live cloud tests

```
$ npm run test
```

Jest sometimes overwrites output during the test (this shows up as garbled Jest
test status output, or missing log messages output through the console).
Redirect stdout to get clean output:

```
$ npm run test > out
$ cat out
```

## Local Testing

```
$ npm run test-local
```

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

# AWS Notes

## IAM Roles

Faast.js will create an IAM role for the lambda function it creates. By default
this role will have administrator access. The role will be created dynamically
and then deleted when the cleanup function is called. Dynamically creating the
role takes some time - up to 5-6 seconds. To speed this up, and also to allow
for less permissive roles, you can create a persistent IAM role manually and
restrict its permissions. Having a cached role will also make function startup
faster because the role will not have to be dynamically created.

```typescript
const RoleName = "...cached role name...";
let cloud = faast.create("aws");
let service = await cloud.createFunction("./functions", {
 RoleName
});
```

There are a minimum set of policy permissions required, namely the ones in `arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`:

```json
{
 "Version": "2012-10-17",
 "Statement": [
  {
   "Effect": "Allow",
   "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
   "Resource": "*"
  }
 ]
}
```

If Faast.js cannot find the role name specified, it will revert back to
dynamically creating a role for you.

If you want to have dynamically created role with custom permissions, specify
the `PolicyArn` option. Faast.js will attach this policy to the role it
dynamically creates.

# Google Cloud Notes

## Node version

Google Cloud Functions only supports node 6.11.5 at the moment (as of 6/2016).
If your code uses any Node APIs that were introduced after this version, it will
fail when run on Google Cloud. This can happen, for example, if your TypeScript
target uses features introduced in later node/V8 versions than 6.11.5. Though
not strictly required, it can be helpful to synchronize the node version on your
local machine with the cloud provider version, which can be accomplished by
adding the following to your `package.json`:

```json
"engines": {
  "node": "6.11.5"
}
```

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
