---
id: faastjs.persistentcache.set
title: PersistentCache.set() method
hide_title: true
---
[faastjs](./faastjs.md) &gt; [PersistentCache](./faastjs.persistentcache.md) &gt; [set](./faastjs.persistentcache.set.md)

## PersistentCache.set() method

Set the cache key to the given value.

<b>Signature:</b>

```typescript
set(key: string, value: Buffer | string | Uint8Array | Readable | Blob): Promise<void>;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  key | `string` |  |
|  value | `Buffer | string | Uint8Array | Readable | Blob` |  |

<b>Returns:</b>

`Promise<void>`

a Promise that resolves when the cache entry has been persisted.
