---
id: limitations
title: Limitations
hide_title: true
---

# Limitations

## Arguments and return values must be serializable

Cloudified function arguments must be serializable with [`JSON.stringify`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify). Faast.js uses a custom `replacer()` function that allows for these types to be safely passed as arguments or return values:

-   `Buffer`
-   `Date`
-   `undefined`
-   `Infinity`
-   `-Infinity`
-   `NaN`
-   `Int8Array`
-   `Uint8Array`
-   `Uint8ClampedArray`
-   `Int16Array`
-   `Uint16Array`
-   `Int32Array`
-   `Uint32Array`
-   `Float32Array`
-   `Float64Array`
-   `Map`
-   `Set`

Faast.js will throw a `FaastError` if it detects a case where an argument or return value cannot be serialized without a loss of information (see [CommonOptions.validateSerialization](./api/faastjs.commonoptions.validateserialization.md)). For example, the following are not supported as cloud function arguments:

-   Promise arguments (however Promise return values are supported)
-   Functions passed as arguments or return values
-   Class instances
-   ... and more. The MDN documentation contains more details about specific cases.

## Size limits on arguments and return values

Arguments and return values are sent through each provider's API or through a cloud queue or notification service, each of which may have a size limit. The limits will depend on the provider and mode being used:

### AWS Limits

Limits for AWS Lambda are published [here](https://docs.aws.amazon.com/lambda/latest/dg/limits.html). These limits manifest differently for [https vs queue mode](./04-aws.md#queue-vs-https-mode).

### Google Limits

Limits for Google Cloud Functions are published [here](https://cloud.google.com/functions/quotas). As of March 2019 the limits are for arguments and return values is 10MB.

### Local limits

In local mode, faast.js uses node's [`process.send()`](https://nodejs.org/api/process.html#process_process_send_message_sendhandle_options_callback) to send messages to worker processes. The IPC limits are OS-specific.
