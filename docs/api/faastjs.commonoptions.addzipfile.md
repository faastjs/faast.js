[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CommonOptions](./faastjs.commonoptions.md) &gt; [addZipFile](./faastjs.commonoptions.addzipfile.md)

## CommonOptions.addZipFile property

Add zip files to the code package.

<b>Signature:</b>

```typescript
addZipFile?: string | string[];
```

## Remarks

Each file is unzipped on the remote side under the current working directory. Zip files can be specified as an absolute path or a relative path. If the path is relative, it is searched for in the following order:

(1) The directory containing the script that imports the `faast` module. Specifically, the value of `__dirname` from that script.

(2) The current working directory of the executing process.

