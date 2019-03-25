---
id: faastjs.commonoptions.memorysize
title: CommonOptions.memorySize property
hide_title: true
---
[faastjs](./faastjs.md) &gt; [CommonOptions](./faastjs.commonoptions.md) &gt; [memorySize](./faastjs.commonoptions.memorysize.md)

## CommonOptions.memorySize property

Memory limit for each function in MB. This setting has an effect on pricing. Default varies by provider.

<b>Signature:</b>

```typescript
memorySize?: number;
```

## Remarks

Each provider has different settings for memory size, and performance varies depending on the setting. By default faast picks a likely optimal value for each provider.

- aws: 1728MB

- google: 1024MB

- local: 512MB
