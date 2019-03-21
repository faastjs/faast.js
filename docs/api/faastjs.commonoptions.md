[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [CommonOptions](./faastjs.commonoptions.md)

## CommonOptions interface

Options common across all faast.js providers. Used as argument to [faast()](./faastjs.faast.md)<!-- -->.

<b>Signature:</b>

```typescript
export interface CommonOptions 
```

## Properties

|  Property | Type | Description |
|  --- | --- | --- |
|  [addDirectory](./faastjs.commonoptions.adddirectory.md) | `string | string[]` | Add local directories to the code package. |
|  [addZipFile](./faastjs.commonoptions.addzipfile.md) | `string | string[]` | Add zip files to the code package. |
|  [childProcess](./faastjs.commonoptions.childprocess.md) | `boolean` | If true, create a child process to isolate user code from faast scaffolding. Default: true. |
|  [concurrency](./faastjs.commonoptions.concurrency.md) | `number` | The maximum number of concurrent invocations to allow. Default: 100, except for the `local` provider, where the default is 10. |
|  [gc](./faastjs.commonoptions.gc.md) | `boolean` | Garbage collection is enabled if true. Default: true. |
|  [maxRetries](./faastjs.commonoptions.maxretries.md) | `number` | Maximum number of times that faast will retry each invocation. Default: 2 (invocations can therefore be attemped 3 times in total). |
|  [memorySize](./faastjs.commonoptions.memorysize.md) | `number` | Memory limit for each function in MB. This setting has an effect on pricing. Default varies by provider. |
|  [mode](./faastjs.commonoptions.mode.md) | `"https" | "queue" | "auto"` | Specify invocation mode. Default: `"auto"`<!-- -->. |
|  [packageJson](./faastjs.commonoptions.packagejson.md) | `string | object` | Specify a package.json file to include with the code package. |
|  [retentionInDays](./faastjs.commonoptions.retentionindays.md) | `number` | Specify how many days to wait before reclaiming cloud garbage. Default: 1. |
|  [timeout](./faastjs.commonoptions.timeout.md) | `number` | Execution time limit for each invocation, in seconds. Default: 60. |
|  [useDependencyCaching](./faastjs.commonoptions.usedependencycaching.md) | `boolean` | Cache installed dependencies from [CommonOptions.packageJson](./faastjs.commonoptions.packagejson.md)<!-- -->. Only applies to AWS. Default: true. |
|  [webpackOptions](./faastjs.commonoptions.webpackoptions.md) | `webpack.Configuration` | Extra webpack options to use to bundle the code package. |

## Remarks

There are also more specific options for each provider. See [AwsOptions](./faastjs.awsoptions.md)<!-- -->, [GoogleOptions](./faastjs.googleoptions.md)<!-- -->, and [LocalOptions](./faastjs.localoptions.md)<!-- -->.

