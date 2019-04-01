---
id: local
title: Local provider
hide_title: true
---

# Running faast.js locally

The local provider allows you to run faast.js functions without a cloud provider account or network connectivity. The primary goal is to provide an easy way to debug faast modules as if they were running in the cloud. Therefore serialization checks and queueing and other activities not strictly necessary for local execution are still performed, to ensure more similarity to faast.js use with a cloud provider.

Each invocation in local mode starts a new process, up to the [concurrency limit](./api/faastjs.commonoptions.concurrency.md). Processes are reused for subsequent calls just as they are in a real cloud function, allowing you to test caching strategies.

## Setup

None.

## Using `faastLocal`

Using the [`faast`](./api/faastjs.faast.md) function works well with the local provider.

The [`faastLocal`](./api/faastjs.faastlocal.md) function allows you to specify more specific [`LocalOptions`](./api/faastjs.localoptions.md). Currently there are no local-specific options.

## Logs

To view logs, see [`logUrl`](./api/faastjs.faastmodule.logurl.md).

The local provider writes logs to disk in a temporary directory. The result of `logUrl` will be a `file://` URL pointing to this directory.

## Dependencies and Packaging

If you specify the [`packageJson`](./api/faastjs.commonoptions.packagejson.md) option, faast.js will write a `package.json` file in the temporary directory created for that faast instance and run `npm install` for you. This should usually simulate the same behavior you would get on other cloud providers when specifying `packageJson`.

## Queue vs Https mode

The local provider does not distinguish between these modes.

## Debugging

One of the main reasons to use the local provider is to make debugging easier. With the local provider, you should be able to run existing debugging tools like the node inspector with Chrome DevTools and the Visual Studio Code debugger.

If [childProcess](./api/faastjs.commonoptions.childprocess.md) is set to `false`, then function code will be run inline instead of in a separate process, which may make debugging even more convenient (though the functions will execute the context of the calling process, and therefore have no concurrency).

## Running on a cloud server

Running in local provider mode on a large EC2 or GCE instance can be a substitute for running on serverless platforms. Large AWS EC2 instances can have up to 128 vCPUs and 2TB of memory. This is sufficient to run many workloads, though with a different pricing model and little scalability beyond the limits of the instance. Still,it can be convenient to simply switch to the local provider mode to compare performance.

Using the local provider on a large instance can also get around certain limitations of serverless platforms. For example, it makes it possible for the invocations to communicate in a low latency manner, share state efficiently, etc. The reduce phase of map-reduce can be implemented in this manner with faast.js.
