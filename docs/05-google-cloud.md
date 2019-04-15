---
id: google-cloud
title: Google Cloud provider
hide_title: true
---

# Running faast.js on Google Cloud Functions

## Setup

Using faast.js with Google Cloud requires creating an account, project, and a service account for the project.

-   Setup [authentication on GCP](https://cloud.google.com/docs/authentication/getting-started).
-   Create a project
-   Create a google [service account](https://console.cloud.google.com/iam-admin/serviceaccounts)
-   Assign Owner permissions for the service account
-   Enable [Cloud functions API](https://console.cloud.google.com/functions)
-   Enable [Cloud Billing API](https://console.developers.google.com/apis/api/cloudbilling.googleapis.com/overview)

That's it. Now you should be able to run faast.js with Google Cloud Functions.

## Using `faastGoogle`

Using the [`faast`](./api/faastjs.faast.md) function works well with Google Cloud, but the [`faastGoogle`](./api/faastjs.faastgoogle.md) function allows you to specify more specific [`GoogleOptions`](./api/faastjs.googleoptions.md).

The most likely reason to use `faastGoogle` is to specify the region:

```typescript
faastGoogle(m, "/path", { region: "us-east1" });
```

## Google Resources

The following diagram shows the Google Cloud resources that faast.js creates:

![faastjs-architecture-google](./assets/faastjs-architecture-google.svg "faast.js architecture for google")

In the `cleanup` function the Request queue, Response queue, and Cloud Function are deleted. Logs are retained according to Google's log retention policy.

All faast.js Google Cloud resources can be removed using the [faastjs cleanup command](./01-introduction.md#cleanup-command).

## Logs

To view logs, see [`logUrl`](./api/faastjs.faastmodule.logurl.md).

Logs go to Stackdriver logging and are retained for 30 days. Log expiration is handled by Google Cloud and faast.js' garbage collector has no effect on Google Cloud logs.

Log ingestion is not included in faast.js cost estimates.

## Package Dependencies

Google Cloud Functions has native support for `package.json` and faast.js uses this when you specify the [`packageJson`](./api/faastjs.commonoptions.packagejson.md) option.

Note these best practices:

-   If you don't need native dependencies, then it is preferable to let faast.js invoke webpack for you to bundle your code instead of specifying `packageJson`.

-   If you do need `packageJson`, the dependencies specified in it should be a subset of those in your project's `package.json` and have the same version constraints.

## Queue vs Https mode

There are two [modes of invocation](./api/faastjs.commonoptions.mode.md) for Google with faast.js, https and queue. PubSub is used to invoke cloud functions in queue mode; in https mode invocations are triggered using the cloud function's URL. Here is a summary of differences between these modes for Google Cloud:

|                           | https mode | queue mode    |
| ------------------------- | ---------- | ------------- |
| latency                   | low        | higher        |
| maximum argument size     | 10MB       | 10MB          |
| maximum return value size | 10MB       | 10MB          |
| max invocations / sec     | ~500/sec   | up to 300/sec |
| reports OOM errors        | yes        | no            |

In queue mode, Google Cloud Functions cannot report back out of memory errors as a promise rejection. Instead, the promise returned by a local proxy will never be resolved or rejected if the remote cloud function runs out of memory.

Note that Google Cloud Functions tends to ramp up slowly, and you may not see maximum invocation rates until one or more minutes.

The default is https mode.

## Node version

Faast.js uses Google Cloud Functions' node8 runtime. If your code uses any Node
APIs that were introduced after this version, it will fail when run on Google
Cloud. Though not strictly required, it can be helpful to synchronize the node
version on your local machine with the cloud provider version, which can be
accomplished by adding the following to your `package.json`:

```json
"engines": {
  "node": "8.15.0"
}
```
