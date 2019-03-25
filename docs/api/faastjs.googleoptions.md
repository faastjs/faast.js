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
|  [googleCloudFunctionOptions](./faastjs.googleoptions.googlecloudfunctionoptions.md) | <code>CloudFunctions.Schema$CloudFunction</code> | Additional options to pass to Google Cloud Function creation. See [projects.locations.functions](https://cloud.google.com/functions/docs/reference/rest/v1/projects.locations.functions#CloudFunction)<!-- -->. |
|  [region](./faastjs.googleoptions.region.md) | <code>string</code> | The region to create resources in. Garbage collection is also limited to this region. Default: <code>&quot;us-central1&quot;</code>. |
