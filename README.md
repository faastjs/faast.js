# Cloudify

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
