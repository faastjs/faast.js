---
id: limitations
title: Limitations
hide_title: true
---

# Limitations

## Arguments and return values must be serializable

Cloudified function arguments must be serializable with [`JSON.stringify`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify). Faast.js will print a warning if it detects a case where `JSON.stringify` will result in a loss of information passed to the function. This may cause unexpected behavior when the code in the lambda function executes. For example, the following are not supported as cloud function arguments:

-   Promise arguments (however Promise return values are supported)
-   `Date` arguments or return values
-   Functions passed as arguments or return values
-   Class instances
-   ... and more. The MDN documentation contains more details about specific cases.

Faast.js tries its best to detect these cases, but 100% detection is not guaranteed.

## Size limits on arguments and return values

Arguments and return values are sent through each provider's API or through a cloud queue or notification service, each of which may have a size limit. The limits will depend on the provider and mode being used:

### AWS Limits

Limits for AWS Lambda are published [here](https://docs.aws.amazon.com/lambda/latest/dg/limits.html). These limits manifest differently for [https vs queue mode](./04-aws-lambda#queue-vs-https-mode).

### Google Limits

Limits for Google Cloud Functions are published [here](https://cloud.google.com/functions/quotas). As of March 2019 the limits are for arguments and return values is 10MB.

### Local limits

In local mode, faast.js uses node's [`process.send()`](https://nodejs.org/api/process.html#process_process_send_message_sendhandle_options_callback) to send messages to worker processes. The IPC limits are OS-specific.
