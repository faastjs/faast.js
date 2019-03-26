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

## Adding a new cloud provider

### Provider API

- provider.ts

## Community statement
