# Cloudify

## Testing

First install google cloud functions emulator:

```
$ npm install -g @google-cloud/functions-emulator
```

Then run the test script:

```
$ npm run test-deploy
```

Which should result in verbose output ending with:

```
... verbose output ...
ExecutionId: 337d5fb8-aaac-45e7-9d63-bc1338b20224
Result: { type: 'returned', value: 'Hello world!' }
```
