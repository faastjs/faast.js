# Faast

The `faast` function is the main interface to Faast.js:

```typescript
faast(provider, module, moduleFile, options): Promise<CloudFunction>
```

where:

- `provider` is "aws" | "google" | "local"
- `module` is the imported module
- `moduleFile` is the location of the imported module, as you would specify to `require` or `import`.
- `options` are the possible [options](./02-options).

and the return value is an instance of `CloudFunction`. The `functions` property contains the same functions as `module`, except they return promises.

For example:

```
import * as functions from "./functions";
const cloudFunc = await faast("aws", functions, "./functions");
```

## Calling remote functions

### Functions must be idempotent

## Cleanup
