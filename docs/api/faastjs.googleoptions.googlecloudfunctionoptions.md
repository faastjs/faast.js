---
id: faastjs.googleoptions.googlecloudfunctionoptions
title: GoogleOptions.googleCloudFunctionOptions property
hide_title: true
---
[faastjs](./faastjs.md) &gt; [GoogleOptions](./faastjs.googleoptions.md) &gt; [googleCloudFunctionOptions](./faastjs.googleoptions.googlecloudfunctionoptions.md)

## GoogleOptions.googleCloudFunctionOptions property

Additional options to pass to Google Cloud Function creation.

<b>Signature:</b>

```typescript
googleCloudFunctionOptions?: CloudFunctions.Schema$CloudFunction;
```

## Remarks

If you need specialized options, you can pass them to the Google Cloud Functions API directly. Note that if you override any settings set by faast.js, you may cause faast.js to not work:

```typescript
 const requestBody: CloudFunctions.Schema$CloudFunction = {
     name,
     entryPoint: "trampoline",
     timeout,
     availableMemoryMb,
     sourceUploadUrl,
     runtime: "nodejs8",
     ...googleCloudFunctionOptions
 };

```
