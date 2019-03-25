---
id: faastjs.googleoptions
title: GoogleOptions interface
hide_title: true
---
[faastjs](./faastjs.md) &gt; [GoogleOptions](./faastjs.googleoptions.md)

## GoogleOptions interface

Google-specific options. Extends [CommonOptions](./faastjs.commonoptions.md)<!-- -->. To be used with [faastGoogle()](./faastjs.faastgoogle.md)<!-- -->.

<b>Signature:</b>

```typescript
export interface GoogleOptions extends CommonOptions 
```

## Properties

|  Property | Type | Description |
|  --- | --- | --- |
|  [googleCloudFunctionOptions](./faastjs.googleoptions.googlecloudfunctionoptions.md) | `CloudFunctions.Schema$CloudFunction` | Additional options to pass to Google Cloud Function creation. |
|  [region](./faastjs.googleoptions.region.md) | `string` | The region to create resources in. Garbage collection is also limited to this region. Default: `"us-central1"`<!-- -->. |
