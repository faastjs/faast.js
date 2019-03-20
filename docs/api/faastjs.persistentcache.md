[Home](./index) &gt; [faastjs](./faastjs.md) &gt; [PersistentCache](./faastjs.persistentcache.md)

## PersistentCache class

A simple persistent key-value store. Used to implement [Limits.cache](./faastjs.limits.cache.md) for [throttle()](./faastjs.throttle.md)<!-- -->.

<b>Signature:</b>

```typescript
export declare class PersistentCache 
```

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [dir](./faastjs.persistentcache.dir.md) |  | `string` | The directory on disk where cached values are stored. |
|  [dirRelativeToHomeDir](./faastjs.persistentcache.dirrelativetohomedir.md) |  | `string` | The directory under the user's home directory that will be used to store cached values. The directory will be created if it doesn't exist. |
|  [expiration](./faastjs.persistentcache.expiration.md) |  | `number` | The age (in ms) after which a cached entry is invalid. Default: `24*3600*1000` (1 day). |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [clear({ leaveEmptyDir })](./faastjs.persistentcache.clear.md) |  | Deletes all cached entries from disk. |
|  [entries()](./faastjs.persistentcache.entries.md) |  | Retrieve all keys stored in the cache, including expired entries. |
|  [get(key)](./faastjs.persistentcache.get.md) |  | Retrieves the value previously set for the given key, or undefined if the key is not found. |
|  [set(key, value)](./faastjs.persistentcache.set.md) |  | Set the cache key to the given value. |

## Remarks

Entries can be expired, but are not actually deleted individually. The entire cache can be deleted at once. Hence this cache is useful for storing results that are expensive to compute but do not change too often (e.g. the node\_modules folder from an 'npm install' where 'package.json' is not expected to change too often).

