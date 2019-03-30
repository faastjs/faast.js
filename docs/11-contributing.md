---
id: contributing
hide_title: true
---

# Contributing to faast.js

## Tooling

- [AVA](https://github.com/avajs/ava) - test runner.

- [Docusaurus](https://docusaurus.io/) - documentation and website.

- [API-extractor](https://api-extractor.com/) - API documentation generator and more.

- [draw.io](https://draw.io) - diagram creator for SVGs.

- [monodraw](https://monodraw.helftone.com/) - ascii diagrams.

## Building

```
$ npm install
$ npm run build
```

The output is placed in `build/`.

## Building in watch mode

This recompiles code on the fly as it's changed.

```
$ npm run watch
```

If you use Visual Studio Code, press `cmd-shift-B`.

## Running the Testsuite

First follow the instructions in the README to setup accounts on cloud providers.

```
$ npm run test
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

### Generate documentation from source comments

Docs are generated as part of `npm run build`. Generating docs requires first ensuring the code is built. Therefore one common flow is to run `npm run watch`, then occassionally update the documentation (the doc generator currently doesn't have watch mode):

```
$ npm run doc
```

Documentation generation uses [API-extractor](https://api-extractor.com/) and [API-documenter](https://api-extractor.com/pages/setup/generating_docs/).

Also see [doc.ts](../src/doc.ts), which executes the documentation build steps.

### Writing API documentation in source code

Use the [documentation tags specified by API-extractor](https://api-extractor.com/pages/tsdoc/syntax/).

### Generating the website

Faast.js uses [docusaurus](https://docusaurus.io/) to generate a static website that includes the generated documentation as an API in `docs/api/*.md`, along with the manual you are currently reading in `docs/*.md`.

Docusaurus has a built-in server:

```
$ cd website
$ npm start
```

This should open your browser allowing you to see a live preview. Note that you'll need to `npm run doc` to get updated API docs.

## Testsuite Design

### Why AVA (and not Jest, Mocha, etc)?

[AVA](https://github.com/avajs/ava) is designed to run all tests _within_ a file concurrently. This is a different architecture than most other JavaScript test frameworks, and it is especially suited to faast.js. The faast.js testsuite needs to create many lambda functions and other infrastructure in the cloud. Performing these operations can take some time, but can be done in parallel easily. Google Cloud Functions takes an espcially long time (sometimes > 1min) for common operations like function creation.

In addition, faast.js has to execute the same tests across a test matrix of cloud providers and configurations:

`{CloudProviders} x {Configurations} x {Tests}`

The most natural way to write these tests is as follows:

```typescript
for (const provider of providers) {
 for (const config of configs) {
  test(...);
 }
}
```

With Jest and most other JavaScript test frameworks, this style of writing tests will result in serialization of each test. Splitting the elements of the test matrix into different files causes the test structure to become more complex than it needs to be because the common test code needs to be factored out, and separate test files need to be created for each cloud provider and possible each configuration in order to achieve sufficient test concurrency.

### What should be tested

Faast.js focuses mostly on integration tests, not unit tests. Faast.js tests on live cloud services in addition to locally. We've found that this test philosophy maximizes ROI on test effort.

### Test location

Tests are located in `test/\*.test.ts`.

### Running AVA tests manually

You can run AVA directly to use more advanced filtering, etc:

```
$ npx ava
```

For example, to run only AWS tests that test garbage collection:

```
$ npx ava -m='*aws*garbage*'
```

### Writing tests

The benefit of AVA is that you have more control over test concurrency. The drawback is that tests need to be written so they don't interfere with each other. This takes some effort and diligence, but basically it boils down to the following:

- Most tests should be written as macros. See [basic.test.ts](../test/basic.test.ts) for an example.

- Each test should create its own faast instance and properly clean it up in a `finally` clause.

- Don't share resources between tests. This includes global or shared variables, objects, files, etc.

- Each test should have a unique test title that is descriptive enough to make filtering easy.

- Don't ignore intermittent test failures. They may indicate a race condition.

### Test titles

Test titles are important. Please following the following rules to ensure the CI tests continue to work as expected:

- Test titles that require network access should begin with `` `remote ${provider}` ``

- Use the `title()` utility function to help ensure you have the right prefix for test titles.

### Test naming

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
