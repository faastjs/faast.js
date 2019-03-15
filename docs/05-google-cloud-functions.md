# Running faast.js on Google Cloud Functions

## Options

## Node version

Faast.js uses Google Cloud Functions' node8 runtime. If your code uses any Node
APIs that were introduced after this version, it will fail when run on Google
Cloud. Though not strictly required, it can be helpful to synchronize the node
version on your local machine with the cloud provider version, which can be
accomplished by adding the following to your `package.json`:

```json
"engines": {
  "node": "8.15.0"
}
```
