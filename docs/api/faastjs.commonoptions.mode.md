[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CommonOptions](./faastjs.commonoptions.md) &gt; [mode](./faastjs.commonoptions.mode.md)

## CommonOptions.mode property

Specify invocation mode. Default: `"auto"`<!-- -->.

<b>Signature:</b>

```typescript
mode?: "https" | "queue" | "auto";
```

## Remarks

Modes specify how invocations are triggered. In https mode, the functions are invoked through an https request or the provider's API. In queue mode, a provider-specific queue is used to invoke functions. Queue mode adds additional latency and (usually negligible) cost, but may scale better for some providers. In auto mode the best default is chosen for each provider depending on its particular performance characteristics.

The defaults are:

- aws: `"auto"` is the same as `"queue"`<!-- -->. In https mode, the AWS SDK api is used to invoke functions. In queue mode, an AWS SNS topic is created and triggers invocations. The AWS API Gateway service is never used by faast, as it incurs a higher cost and is not needed to trigger invocations.

- google: `"auto"` is `"https"`<!-- -->. In https mode, a PUT request is made to invoke the cloud function. In queue mode, a PubSub topic is created to invoke functions.

- local: The local provider ignores the mode setting and always uses an internal asynchronous queue to schedule calls.

Note that no matter which mode is selected, faast.js always uses queue to send results back. This queue is required because there are intermediate data that faast.js needs for bookeeping and performance monitoring.

