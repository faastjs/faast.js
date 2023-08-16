---
id: faastjs.persistentcache.set
title: PersistentCache.set() method
hide_title: true
---
<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[faastjs](./faastjs.md) &gt; [PersistentCache](./faastjs.persistentcache.md) &gt; [set](./faastjs.persistentcache.set.md)

## PersistentCache.set() method

Set the cache key to the given value.

**Signature:**

```typescript
set(key: string, value: Buffer | string | Uint8Array): Promise<void>;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  key | string |  |
|  value | Buffer &#124; string &#124; Uint8Array |  |

**Returns:**

Promise&lt;void&gt;

a Promise that resolves when the cache entry has been persisted.