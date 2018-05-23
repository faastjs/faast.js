# Cloudify

```
$ yarn install
$ yarn build
```

## Testing

First install google cloud functions emulator (unfortunately it must be
installed globally to work):

```
$ npm install -g @google-cloud/functions-emulator
```

Then run the test script:

```
$ DEBUG=cloudify yarn test-deploy-google
```

Which should result in verbose output ending with:

```
... verbose output ...
ExecutionId: 337d5fb8-aaac-45e7-9d63-bc1338b20224
Result: { type: 'returned', value: 'Hello world!' }
```
