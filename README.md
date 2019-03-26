[![CircleCI](https://circleci.com/gh/acchou/faast.js.svg?style=shield&circle-token=c97f196a78c7173d6ca4e5fc9f09c2cba4ab0647)](https://circleci.com/gh/acchou/faast.js) [![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Facchou%2Ffaast.js.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Facchou%2Ffaast.js?ref=badge_shield)

# Faast.js

Faast.js dynamically transforms JavaScript modules into scalable serverless functions.

- **Scalable:** Use serverless functions to scale your batch jobs up to thousands of cores.
- **Cost-effective:** Understand and optimize your workload costs in real time. Pay only for compute time actually used.
- **Ephemeral:** No clusters or services to manage. Faast.js creates the infrastructure it uses on the fly and cleans up when it's done.
- **Developer optimized:** First class support for TypeScript and JavaScript. Type safety, documentation, and extensive testing are part of our DNA.
- **Portable:** Built-in support for AWS Lambda and Google Cloud Functions, as well as local processing mode when you don't have network access. Switch with one line of code.

## Installation

Faast.js requires node version 8+.

```bash
$ npm install faastjs
```

## Example

Export your cloud functions in a module, and invoke faast.js on that module:

```typescript
// functions.ts
export function hello(name: string) {
 return "hello " + name;
}
```

```typescript
// main.ts
import { faast } from "faastjs";
import * as funcs from "./functions";

(async () => {
 const m = await faast("aws", funcs, "./functions");
 const { hello } = m.functions;
 const result = await hello("world!");
 console.log(result);
 await m.cleanup();
})();
```

Make 1000 calls concurrently if you like...

```typescript
const promises: string[] = [];
for (let i = 0; i < 1000; i++) {
 promises.push(hello(`world ${i}!`));
}
await Promise.all(promises);
```

...and instantly see how much it costs:

```typescript
const cost = await m.costSnapshot();
console.log(cost);
```

```
functionCallDuration  $0.00002813/second          102.0 seconds    $0.00286876    68.2%  [1]
sqs                   $0.00000040/request          1276 requests   $0.00051040    12.1%  [2]
sns                   $0.00000050/request          1000 requests   $0.00050000    11.9%  [3]
functionCallRequests  $0.00000020/request          1000 requests   $0.00020000     4.8%  [4]
outboundDataTransfer  $0.09000000/GB         0.00143808 GB         $0.00012943     3.1%  [5]
logIngestion          $0.50000000/GB                  0 GB         $0              0.0%  [6]
---------------------------------------------------------------------------------------
                                                                   $0.00420858 (USD
```

It's that easy.

## Ready to learn more?

Check out our [documentation](./docs/01-introduction.md) or detailed [API](./docs/api/faastjs.md).

## Contributing

See [contributing](./docs/11-contributing)
