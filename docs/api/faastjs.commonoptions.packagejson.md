---
id: faastjs.commonoptions.packagejson
title: CommonOptions.packageJson property
hide_title: true
---
[faastjs](./faastjs.md) &gt; [CommonOptions](./faastjs.commonoptions.md) &gt; [packageJson](./faastjs.commonoptions.packagejson.md)

## CommonOptions.packageJson property

Specify a package.json file to include with the code package.

<b>Signature:</b>

```typescript
packageJson?: string | object;
```

## Remarks

By default, faast.js will use webpack to bundle dependencies your remote module imports. In normal usage there is no need to specify a separate package.json, as webpack will statically analyze your imports and determine which files to bundle.

However, there are some use cases where this is not enough. For example, some dependencies contain native code compiled during installation, and webpack cannot bundle these native modules. such as dependencies with native code. or are specifically not designed to work with webpack. In these cases, you can create a separate `package.json` for these dependencies and pass the filename as the `packageJson` option. If `packageJson` is an `object`<!-- -->, it is assumed to be a parsed JSON object with the same structure as a package.json file (useful for specifying a synthetic `package.json` directly in code).

The way the `packageJson` is handled varies by provider:

- local: Runs `npm install` in a temporary directory it prepares for the function.

- google: uses Google Cloud Function's [native support for package.json](https://cloud.google.com/functions/docs/writing/specifying-dependencies-nodejs)<!-- -->.

- aws: Recursively calls faast.js to run `npm install` inside a separate lambda function specifically created for this purpose. Faast.js uses lambda to install dependencies to ensure that native dependencies are compiled in an environment that can produce binaries linked against lambda's [execution environment](https://aws.amazon.com/blogs/compute/running-executables-in-aws-lambda/)<!-- -->. Packages are saved in a Lambda Layer.

For AWS, if [CommonOptions.useDependencyCaching](./faastjs.commonoptions.usedependencycaching.md) is `true` (which is the default), then the Lambda Layer created will be reused in future function creation requests if the contents of `packageJson` are the same.

The path specified by `packageJson` is searched for in the same manner as [CommonOptions.addZipFile](./faastjs.commonoptions.addzipfile.md)<!-- -->.

The `FAAST_PACKAGE_DIR` environment variable can be useful for debugging `packageJson` issues.
