[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CleanupOptions](./faastjs.cleanupoptions.md) &gt; [deleteCaches](./faastjs.cleanupoptions.deletecaches.md)

## CleanupOptions.deleteCaches property

If true, delete cached resources. Default: false.

<b>Signature:</b>

```typescript
deleteCaches?: boolean;
```

## Remarks

Some resources are cached persistently between calls for performance reasons. If this option is set to true, these cached resources are deleted when cleanup occurs, instead of being left behind for future use. For example, on AWS this includes the Lambda Layers that are created for [CommonOptions.packageJson](./faastjs.commonoptions.packagejson.md) dependencies. Note that only the cached resources created by this instance of FaastModule are deleted, not cached resources from other FaastModules. This is similar to setting `useCachedDependencies` to `false` during function construction, except `deleteCaches` can be set at function cleanup time, and any other FaastModules created before cleanup may use the cached Layers.

