# <a href="https://faastjs.org"><img alt="faast.js" src="./website/static/img/faastjs.png" height="50"></a>

[![License](https://img.shields.io/badge/License-Apache%202.0-green.svg)](https://opensource.org/licenses/Apache-2.0) [![CircleCI](https://circleci.com/gh/faastjs/faast.js.svg?style=shield&circle-token=c97f196a78c7173d6ca4e5fc9f09c2cba4ab0647)](https://circleci.com/gh/faastjs/faast.js) [![codecov](https://codecov.io/gh/faastjs/faast.js/branch/master/graph/badge.svg?token=Ml90RLLbEh)](https://codecov.io/gh/faastjs/faast.js) [![Codacy Badge](https://api.codacy.com/project/badge/Grade/1132c1cda6a24a5d85d7c7c61c849ef6)](https://www.codacy.com?utm_source=github.com&utm_medium=referral&utm_content=faastjs/faast.js&utm_campaign=Badge_Grade)[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release) [![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Ffaastjs%2Ffaast.js.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Ffaastjs%2Ffaast.js?ref=badge_shield)

Faast.js makes regular functions callable as serverless functions on AWS Lambda and Google Cloud. It handles the details of uploading your code, creating cloud infrastructure, and cleaning up. Scale up your functions to a thousand cores in seconds :rocket:

Faast.js is a pure library with no service dependencies, operational overhead, or unnecessary complexity.

## Installation

Faast.js requires node version 8+.

```shell
$ npm install faastjs
```

## Example

First write the functions you want to run in a serverless function. Make sure to export them:

```typescript
// functions.ts
export function hello(name: string) {
    return "hello " + name;
}
```

Use faast.js to turn this into a serverless function:

```typescript
// main.ts
import { faast } from "faastjs";
import * as funcs from "./functions";

(async () => {
    const m = await faast("aws", funcs);
    const { hello } = m.functions;
    const result = await hello("world!");
    console.log(result);
    await m.cleanup();
})();
```

Make 1000 concurrent calls if you like:

```typescript
const promises: string[] = [];
for (let i = 0; i < 1000; i++) {
    promises.push(hello(`world ${i}!`));
}
await Promise.all(promises);
```

How much did that cost...?

```typescript
const cost = await m.costSnapshot();
console.log(`$${cost.total()}`);
```

Relax. It's just half a penny:

```
$0.00420858
```

## Features

-   **Frictionless.** Faast.js takes care of packaging your code, setting up IAM roles, and other infrastructure complexity. Run your code on a thousand cores in seconds. All you need is an AWS or GCP account.
-   **Scalable.** Use serverless functions to scale your batch jobs up to thousands of cores.
-   **Cost-effective.** Understand and optimize your workload costs in real time. Pay only for compute time actually used.
-   **Ephemeral.** No clusters or services to manage. Faast.js creates the infrastructure it uses on the fly and cleans up when it's done.
-   **Productive.** First class support for TypeScript and JavaScript. Type safety, documentation, and extensive testing are part of our DNA.
-   **Multi-cloud:** Built-in support for AWS Lambda and Google Cloud Functions, as well as local processing mode when you don't have network access. Switch with one line of code.

## Ready to learn more?

Check out our [getting started documentation](https://faastjs.org/docs/introduction).

Work through some [examples](https://github.com/faastjs/examples)

Review the detailed [API documentation](https://faastjs.org/docs/api/faastjs).

Join our [slack channel](https://join.slack.com/t/faastjs/shared_invite/enQtNTk0NTczMzI4NzQxLTA2MWU1NDA1ZjBkOTc3MTNkOGMzMDY0OWU1NGQ5MzM2NDY1YTJiZmNmODk4NzI0OWI1MzZhZDdiOTIzODNkOGY). Already joined? [sign in](https://faastjs.slack.com/).

Follow us on [twitter](https://twitter.com/faastjs).

## Contributing

See [contributing](./docs/12-contributing.md).
