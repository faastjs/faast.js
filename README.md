# Cloudify

Ad-hoc serverless batch processing for nodejs.

```

```

## Building

```
$ yarn install
$ yarn build
```

## Local Testing

First install google cloud functions emulator (unfortunately it must be
installed globally to work):

```
$ npm install -g @google-cloud/functions-emulator
```

Then run the test script:

```
$ DEBUG=cloudify yarn test-local
```

## Testing live cloud services

Setup credentials for [GCP](https://cloud.google.com/sdk/docs/authorizing) and [AWS](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html).

The test target also runs the test-local test cases, so installation of the
Google cloud functions emulator is required.

```
$ yarn test
```

To just run remote tests for a specific service provider:

```
yarn build
DEBUG=cloudify npx jest build/test/aws.test.js
DEBUG=cloudify npx jest build/test/google.test.js
```

# Principles

- Ephemeral functions: Cloudify cleans up after itself. It removes functions, roles, logs, and log groups. By default it will leave no trace in your infrastructure once cleanup is completed.
- Avoids resource exhaustion: doesn't take up log space, function name space, and other limits. Only currently executing functions take up infrastructure namespace.
- Independence: two separate jobs can be run at the same time and they will not interfere with each other.
- Works with AWS and Google Cloud Platform.

# AWS Notes

## IAM Roles

Cloudify will create an IAM role for the lambda function it creates. By default this role will have administrator access. The role will be created dynamically and then deleted when the cleanup function is called. Dynamically creating the role takes some time - up to 5-6 seconds. To speed this up, and also to allow for less permissive roles, you can create a persistent IAM role manually and restrict its permissions. Having a cached role will also make function startup faster because the role will not have to be dynamically created.

```typescript
const RoleName = "...cached role name...";
let cloud = cloudify.create("aws");
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

If Cloudify cannot find the role name specified, it will revert back to dynamically creating a role for you.

If you want to have dynamically created role with custom permissions, specify the `PolicyArn` option. Cloudify will attach this policy to the role it dynamically creates.

# Google Cloud Notes

## Node version

Google Cloud Functions only supports node 6.11.5 at the moment (as of 6/2016).
If your code uses any Node APIs that were introduced after this version, it will
fail when run on Google Cloud. This can happen, for example, if your TypeScript
target uses features introduced in later node/V8 versions than 6.11.5. Though
not strictly required, it can be helpful to synchronize the node version on your
local machine with the remote cloud, which can be accomplished by adding the
following to your `package.json`:

```json
"engines": {
  "node": "6.11.5"
}
```

# Cleaning up stray resources

Use the `cloudify-cleanup` utility to clean up stray resources that may be left by cloudify in some rare instances (e.g. crashes where cleanup is not invoked):

```
$ node build/src/cloudify-cleanup.js aws
```

By default the utility runs in dry-run mode, only printing the actions it will
perform. To actually execute the cleanup, specify the `-x` option:

```
$ node build/src/cloudify-cleanup.js aws -x
```

# Concurrency

Empirically we see a 50 concurrent cloud function execution limit. It's unclear
where this limit is coming from. Here are some possibilities:

- [ ] At the cloud layer
  - [ ] Try both AWS and Google
  - [ ] Issue requests to the same function from multiple machines.
- [ ] At the MacOS layer.
  - [ ] Try running the load test from EC2.
  - [ ] Remove the
- [ ] At the Node.js layer.
  - [*] Run two different loads from one client.
  - [ ] Try latest node version
  - [ ] Try changing node libuv thread pool size
  - [ ] Try changing v8 thread pool size
  - [ ] Consider NODE_ENV=production?
- [ ] At the http layer
  - [ ] Turn on logging for low level http requests and responses
  - [ ] Use nock to mock/intercept/record and log http requests
- [ ] At the cloud API layer
  - [ ] Try both AWS and Google
- [ ] At the Axios layer (Google only)
  - [ ] Turn on logging for Axio requests - Axios interceptors
