[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CommonOptions](./faastjs.commonoptions.md) &gt; [addDirectory](./faastjs.commonoptions.adddirectory.md)

## CommonOptions.addDirectory property

Add local directories to the code package.

<b>Signature:</b>

```typescript
addDirectory?: string | string[];
```

## Remarks

Each directory is recursively traversed. On the remote side, the directories will be available on the file system relative to the current working directory. Directories can be specified as an absolute path or a relative path. If the path is relative, it is searched for in the following order:

(1) The directory containing the script that imports the `faast` module. Specifically, the value of `__dirname` from that script.

(2) The current working directory of the executing process.

