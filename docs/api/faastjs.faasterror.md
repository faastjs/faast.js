[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [FaastError](./faastjs.faasterror.md)

## FaastError class

Error type returned by cloud functions when they reject their promises with an instance of Error or any object.

<b>Signature:</b>

```typescript
export declare class FaastError extends Error 
```

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [logUrl](./faastjs.faasterror.logurl.md) |  | `string` | The log URL for the specific invocation that caused this error. |

## Remarks

When a faast.js cloud function throws an exception or rejects the promise it returns with an instance of Error or any object, that error is returned as a `FaastError` on the local side. The original error type is not used. `FaastError` copies the properties of the original error and adds them to FaastError.

If available, a log URL for the specific invocation that caused the error is appended to the log message. This log URL is also available as the `logUrl` property. It will be surrounded by whilespace on both sides to ease parsing as a URL by IDEs.

Stack traces and error names should be preserved from the cloud side.

