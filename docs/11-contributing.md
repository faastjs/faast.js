# Contributing to faast.js

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

### All "fast" live cloud tests

First follow the instructions in the README to setup accounts on cloud
providers.

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

## Testsuite

### Why AVA and not Jest, Mocha, etc?

## Adding a new cloud provider

### Provider API

- provider.ts

## Community statement
