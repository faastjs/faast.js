---
id: faastjs.commonoptions
title: CommonOptions interface
hide_title: true
---
<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[faastjs](./faastjs.md) &gt; [CommonOptions](./faastjs.commonoptions.md)

## CommonOptions interface

Options common across all faast.js providers. Used as argument to [faast()](./faastjs.faast.md)<!-- -->.

**Signature:**

```typescript
export interface CommonOptions 
```

## Remarks

There are also more specific options for each provider. See [AwsOptions](./faastjs.awsoptions.md) and [LocalOptions](./faastjs.localoptions.md)<!-- -->.

## Properties

<table><thead><tr><th>

Property


</th><th>

Modifiers


</th><th>

Type


</th><th>

Description


</th></tr></thead>
<tbody><tr><td>

[childProcess?](./faastjs.commonoptions.childprocess.md)


</td><td>


</td><td>

boolean


</td><td>

_(Optional)_ If true, create a child process to isolate user code from faast scaffolding. Default: true.


</td></tr>
<tr><td>

[childProcessMemoryMb?](./faastjs.commonoptions.childprocessmemorymb.md)


</td><td>


</td><td>

number


</td><td>

_(Optional)_ When childProcess is true, the child process will be spawned with the value of this property as the setting for --max-old-space-size.


</td></tr>
<tr><td>

[concurrency?](./faastjs.commonoptions.concurrency.md)


</td><td>


</td><td>

number


</td><td>

_(Optional)_ The maximum number of concurrent invocations to allow. Default: 100, except for the `local` provider, where the default is 10.


</td></tr>
<tr><td>

[description?](./faastjs.commonoptions.description.md)


</td><td>


</td><td>

string


</td><td>

_(Optional)_ A user-supplied description for this function, which may make it easier to track different functions when multiple functions are created.


</td></tr>
<tr><td>

[env?](./faastjs.commonoptions.env.md)


</td><td>


</td><td>

{ \[key: string\]: string; }


</td><td>

_(Optional)_ Environment variables available during serverless function execution. Default: {<!-- -->}<!-- -->.


</td></tr>
<tr><td>

[exclude?](./faastjs.commonoptions.exclude.md)


</td><td>


</td><td>

string\[\]


</td><td>

_(Optional)_ Exclude a subset of files included by [CommonOptions.include](./faastjs.commonoptions.include.md)<!-- -->.


</td></tr>
<tr><td>

[gc?](./faastjs.commonoptions.gc.md)


</td><td>


</td><td>

"auto" \| "force" \| "off"


</td><td>

_(Optional)_ Garbage collector mode. Default: `"auto"`<!-- -->.


</td></tr>
<tr><td>

[include?](./faastjs.commonoptions.include.md)


</td><td>


</td><td>

(string \| [IncludeOption](./faastjs.includeoption.md)<!-- -->)\[\]


</td><td>

_(Optional)_ Include files to make available in the remote function. See [IncludeOption](./faastjs.includeoption.md)<!-- -->.


</td></tr>
<tr><td>

[maxRetries?](./faastjs.commonoptions.maxretries.md)


</td><td>


</td><td>

number


</td><td>

_(Optional)_ Maximum number of times that faast will retry each invocation. Default: 2 (invocations can therefore be attemped 3 times in total).


</td></tr>
<tr><td>

[memorySize?](./faastjs.commonoptions.memorysize.md)


</td><td>


</td><td>

number


</td><td>

_(Optional)_ Memory limit for each function in MB. This setting has an effect on pricing. Default varies by provider.


</td></tr>
<tr><td>

[mode?](./faastjs.commonoptions.mode.md)


</td><td>


</td><td>

"https" \| "queue" \| "auto"


</td><td>

_(Optional)_ Specify invocation mode. Default: `"auto"`<!-- -->.


</td></tr>
<tr><td>

[packageJson?](./faastjs.commonoptions.packagejson.md)


</td><td>


</td><td>

string \| object


</td><td>

_(Optional)_ Specify a package.json file to include with the code package.


</td></tr>
<tr><td>

[rate?](./faastjs.commonoptions.rate.md)


</td><td>


</td><td>

number


</td><td>

_(Optional)_ Rate limit invocations (invocations/sec). Default: no rate limit.


</td></tr>
<tr><td>

[retentionInDays?](./faastjs.commonoptions.retentionindays.md)


</td><td>


</td><td>

number


</td><td>

_(Optional)_ Specify how many days to wait before reclaiming cloud garbage. Default: 1.


</td></tr>
<tr><td>

[speculativeRetryThreshold?](./faastjs.commonoptions.speculativeretrythreshold.md)


</td><td>


</td><td>

number


</td><td>

**_(BETA)_** _(Optional)_ Reduce tail latency by retrying invocations that take substantially longer than other invocations of the same function. Default: 3.


</td></tr>
<tr><td>

[timeout?](./faastjs.commonoptions.timeout.md)


</td><td>


</td><td>

number


</td><td>

_(Optional)_ Execution time limit for each invocation, in seconds. Default: 60.


</td></tr>
<tr><td>

[useDependencyCaching?](./faastjs.commonoptions.usedependencycaching.md)


</td><td>


</td><td>

boolean


</td><td>

_(Optional)_ Cache installed dependencies from [CommonOptions.packageJson](./faastjs.commonoptions.packagejson.md)<!-- -->. Only applies to AWS. Default: true.


</td></tr>
<tr><td>

[validateSerialization?](./faastjs.commonoptions.validateserialization.md)


</td><td>


</td><td>

boolean


</td><td>

_(Optional)_ Check arguments and return values from cloud functions are serializable without losing information. Default: true.


</td></tr>
<tr><td>

[webpackOptions?](./faastjs.commonoptions.webpackoptions.md)


</td><td>


</td><td>

webpack.Configuration


</td><td>

_(Optional)_ Extra webpack options to use to bundle the code package.


</td></tr>
</tbody></table>