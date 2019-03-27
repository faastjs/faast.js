---
id: contributing
title: Contributing
---

# Contributing to faast.js

Tooling:

- [AVA](https://github.com/avajs/ava) - test runner.

- [Docusaurus](https://docusaurus.io/) - documentation and website.

- [API-extractor](https://api-extractor.com/) - API documentation generator and more.

## Building

```
$ npm install
$ npm run build
```

## Running the Testsuite

First follow the instructions in the README to setup accounts on cloud providers.

```
$ npm run test
```

Redirect stdout to get clean output:

```
$ npm run test > out
$ cat out
```

### Only run AWS and local tests

```
npm run test-aws
```

### Only run Google and local tests

```
npm run test-google
```

### Local Testing (no network required)

```
$ npm run test-local
```

## Testsuite Design

### Why AVA and not Jest, Mocha, etc?

## Continuous integration with CircleCI

See `.circleci/config.yml`. On CircleCI's project settings page, you need to set environment variables to run tests on the cloud providers:

```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
GOOGLE_APPLICATION_CREDENTIALS
GOOGLE_KEY_VALUE
```

The AWS environment variables are as documented for [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html).

The Google environment variables are different because Google requires pointing to a file on disk in the environment variable. To get around this, the run script `npm run set-gcp-key` will copy the contents of the `GOOGLE_KEY_VALUE` environment variable into the file `gcp-key.json` in the current working directory. Then, you can set `GOOGLE_APPLICATION_CREDENTIALS` to `gcp-key.json` for Google authentication to work. In summary:

- Set `GOOGLE_KEY_VALUE` to the contents of your Google service account key, which should be a JSON file.

- Set `GOOGLE_APPLICATION_CREDENTIALS` to `gcp-key.json`

## Adding a new cloud provider

### Provider API

- provider.ts

## Community statement
