---
id: faastjs.commonoptions.webpackoptions
title: CommonOptions.webpackOptions property
hide_title: true
---
[faastjs](./faastjs.md) &gt; [CommonOptions](./faastjs.commonoptions.md) &gt; [webpackOptions](./faastjs.commonoptions.webpackoptions.md)

## CommonOptions.webpackOptions property

Extra webpack options to use to bundle the code package.

<b>Signature:</b>

```typescript
webpackOptions?: webpack.Configuration;
```

## Remarks

By default, faast.js uses webpack to bundle the code package. Webpack automatically handles finding and bundling dependencies, adding source mappings, etc. If you need specialized bundling, use this option to add or override the default webpack configuration:

```typescript
const config: webpack.Configuration = {
  entry,
  mode: "development",
  output: {
      path: "/",
      filename: outputFilename,
      libraryTarget: "commonjs2"
  },
  target: "node",
  resolveLoader: { modules: [__dirname, `${__dirname}/build}`] },
  ...webpackOptions
};

```
Take care not to override the values of `entry`<!-- -->, `output`<!-- -->, or `resolveLoader`<!-- -->. If these options are overwritten, faast.js may fail to bundle your code.

Default:

- aws: `{ externals: new RegExp("^aws-sdk/?") }`<!-- -->. In the lambda environment `"aws-sdk"` is available in the ambient environment and does not need to be bundled.

- other providers: `{}`

The `FAAST_PACKAGE_DIR` environment variable can be useful for debugging webpack issues.
