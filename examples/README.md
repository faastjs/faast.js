# Simple faast.js examples

These examples are mainly for the website. More comprehensive examples are in a separate examples repository on github: https://github.com/faastjs/examples.

## Setup

To run these examples, first build the faast.js repository (in the directory above `examples`), then globally link the `faastjs` package:

```shell
$ cd ..
$ npm install
$ npm run build
$ npm link
```

## Building

Next build the examples:

```shell
$ cd examples
$ npm install
$ npm link faastjs
$ npm run build
```

Note that `npm link faastjs` must be done every time after `npm install` is performed.

## Running

Run specific examples:

```shell
$ node dist/hello-world.js
```

## Examples

| Example        | Description                                           |
| -------------- | ----------------------------------------------------- |
| hello-world.ts | hello world example                                   |
| invoke-n.ts    | invoke hello world N times and output a cost estimate |
| invoke-1000.ts | invoke hello world 1000 times                         |
