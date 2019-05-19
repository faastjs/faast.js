---
id: workflow
title: Development Workflow
hide_title: true
---

# Development Workflow

There's a natural way to use faast.js to maximize developer productivity:

1. Design a regular JS/TS module and export functions with arguments that are safe for `JSON.stringify`.

2. Write tests for your module and use all the great debugging tools you're used to, like [node inspector](https://nodejs.org/en/docs/guides/debugging-getting-started/), Chrome DevTools, and Visual Studio Code.

3. Use the `"local"` provider to test your function as a faast.js module. In this mode your invocations execute in local processes. Debug any issues using standard debugging tools you know and love. Make sure your functions are idempotent by invoking them multiple times concurrently with the same arguments.

4. Switch from `"local"` to `"aws"` or `"google"` but limit [concurrency](./api/faastjs.commonoptions.concurrency.md) to a low amount, between 1-10. Use [logUrl](./api/faastjs.faastmodule.logurl.md) to review cloud logs of your code executing. The [DEBUG](#debug-environment-variable) environment variable can be useful to see verbose output as well.

5. Next, run a sample of your workload through [cost analyzer](./api/faastjs.costanalyzer.md) to find a good cost-performance tradeoff for the choice of memory size. A good default choice for CPU or S3-bandwidth bound workloads is between 1728MV-2048MB on AWS.

6. Gradually increase concurrency and fix any issues that arise from scaling.

Using this workflow maximizes your ability to use local debugging tools, and confines most errors to local or small scale cloud testing. This can help avoid costly mistakes which consume lots of processing time on a large scale.

## Debugging

### Understanding code bundles with `FAAST_PACKAGE_DIR`

If the environment variable `FAAST_PACKAGE_DIR` points to a directory, faast.js will place zip files it creates for each cloud function in the directory. These files are helpful in understanding what faast.js actually uploads to the cloud provider.

Note that if `packageJson` is specified, AWS Lambda Layers are not in the code bundle but rather specified as part of instantiating the lambda function.

### DEBUG environment variable

Turn on verbose logging by setting the `DEBUG` environment variable. For example:

```shell
$ DEBUG=faast:info node example.js
$ DEBUG=faast:* node example.js
```

These options are available:

-   `faast:*` - Turn on all logging.
-   `faast:info` - Basic verbose logging. Disabled by default.
-   `faast:warning` - Output warnings to console.warn. Enabled by default.
-   `faast:gc` - Print debugging information related to garbage collection. Disabled by default.
-   `faast:leaks` - Print debugging information when a memory is potentially detected within the faast.js module. Enabled by default. See XXX.
-   `faast:calls` - Print debugging information about each call to a cloud function. Disabled by default.
-   `faast:webpack` - Print debugging information about webpack, used to pack up cloud function code. Disabled by default.
-   `faast:provider` - Print debugging information about each interaction with cloud-provider specific code from the higher-level faast.js abstraction. Useful for debugging issues with specific cloud providers. Disabled by default.
-   `faast:awssdk` - Only available for AWS, this enables aws-sdk's verbose logging output. Disabled by default.
-   `faast:retry` - Verbose logging of retry attempts. Only logs faast-level and google provider retries.
