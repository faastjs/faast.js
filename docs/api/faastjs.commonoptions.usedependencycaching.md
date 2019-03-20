[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CommonOptions](./faastjs.commonoptions.md) &gt; [useDependencyCaching](./faastjs.commonoptions.usedependencycaching.md)

## CommonOptions.useDependencyCaching property

Cache installed dependencies from [CommonOptions.packageJson](./faastjs.commonoptions.packagejson.md)<!-- -->. Only applies to AWS. Default: true.

<b>Signature:</b>

```typescript
useDependencyCaching?: boolean;
```

## Remarks

If `useDependencyCaching` is `true`<!-- -->, The resulting `node_modules` folder is cached in a Lambda Layer with the name `faast-${key}`<!-- -->, where `key` is the SHA1 hash of the `packageJson` contents. These cache entries are removed by garbage collection, by default after 24h. Using caching reduces the need to install and upload dependencies every time a function is created. This is important for AWS because it creates an entirely separate lambda function to install dependencies remotely, which can substantially increase function deployment time.

If `useDependencyCaching` is false, the lambda layer is created with the same name as the lambda function, and then is deleted when cleanup is run.

