---
id: errors
title: Commonly seen errors
---

# Errors seen while developing

A catalogue of common testsuite failure error messages and their root causes.

## Failure in AWS basic calls with packageJson

Error message:

```
2 tests failed
  remote aws basic calls { mode: 'https', packageJson: 'test/fixtures/package.json', useDependencyCaching: false }
  Error: Promise returned by test never resolved
  remote aws basic calls { mode: 'queue', packageJson: 'test/fixtures/package.json', useDependencyCaching: false }
  Error: Promise returned by test never resolved
```

The error only occurred when both of these tests were run concurrently, not when they were run separately.

The root cause was the introduction of throttling of the AWS provider's initialize function. Throttling was introduced to reduce the occurrence of rate limit errors in the testsuite. But the throttling limit was set to concurrency level 2:

```typescript
export const initialize = throttle(
    { concurrency: 2, rate: 2 },
```

In this test case the concurrency level was set to 2, but both execution slots were taken up by the test cases' calls to `faast`, which called the AWS provider's `initialize`. Within `initialize` there is a recursive call to run a lambda to install npm modules within a lambda function. Both of these tests attempted to execute this recursive call, but no slots were available to execute these recursive invocations because of the throttling function. This emptied the node event loop and caused Ava to correctly point out that the promises returned for initializing functions never resolved.

Starvation is not fun, is it?

The resolution was to set the `concurrency` to `Infinity`, but set the rate low enough to avoid triggering the rate limit. A finite but higher concurrency level would avoid this issue in almost all practical circumstances, but it is not clear we need an actual limit as long as the rate of lambda creation requests is slow enough.

## Testsuite timeout

A testsuite timeout looks like this:

```
 ✖ Timed out while running tests
```

In addition there will be messages from the Ava test framework about various tests that are pending. First, understand that Ava's timeout is different from other test frameworks. Instead of being a test-specific timeout, the timeout specifies the amount of time "between" test completion events. The goal for Ava is to detect a testsuite that is stalled, not to measure performance of a specific test. This is because Ava runs tests concurrently, and the time taken by each test will be highly variable depending on the other async operations in progress.

Also confusing is that Ava will claim certain tests are pending that should not run at all. For example, on the Google testsuite Ava may say there are AWS tests pending, even though they are filtered out and not supposed to run at all:

```
Step #2: 7 tests were pending in /workspace/build/test/basic.test.js
Step #2:
Step #2: ◌ basic › remote aws basic calls { mode: 'https', childProcess: false }
Step #2: ◌ basic › remote aws basic calls { mode: 'https', childProcess: true }
Step #2: ◌ basic › remote aws basic calls { mode: 'queue', childProcess: false }
Step #2: ◌ basic › remote aws basic calls { mode: 'queue', childProcess: true }
Step #2: ◌ basic › remote aws cost estimate for basic calls
Step #2: ◌ basic › remote aws basic calls { mode: 'https', packageJson: 'test/fixtures/package.json', useDependencyCaching: false }
Step #2: ◌ basic › remote aws basic calls { mode: 'queue', packageJson: 'test/fixtures/package.json', useDependencyCaching: false }
Step #2:
```

Ava is just printing out the names of tests it hasn't processed yet, even if they might be filtered out. The key to identifying a real timeout is to determine which of the pending tests is not filtered out, and is currently running. Examination of the above test results shows there is indeed a google test running:

```
Step #2: 2 tests were pending in /workspace/build/test/cost.test.js
Step #2:
Step #2: ◌ cost › remote aws cost analyzer
Step #2: ◌ cost › remote google cost analyzer
```

## unit-package google package test error

Error message:

```
google-https-package

  /Users/achou/Code/faast.js/test/unit-packer.test.ts:58

   57:     const bytes = (await stat(zipFile)).size;
   58:     t.true(bytes < size);
   59:     t.is(exec(`cd ${tmpDir} && node index.js`), "faast: successful cold start.\n");

  Value is not `true`:

  false

  bytes < size
  => false

  size
  => 133120

  bytes
  => 703656
```

This can be caused by having the wrong test/fixtures/package.json. In particular, `googleapis` should be a dependency because adding it makes webpack skip googleapis and leaves it as an external, so the package size is much smaller.

## Unhandled rejection error

This was a mysterious one:

```
  Unhandled rejection in build/test/package.test.js

  /Users/achou/Code/faast.js/node_modules/aws-sdk/lib/protocol/json.js:51

  ResourceNotFoundException: Function not found: arn:aws:lambda:us-west-2:343675226624:function:faast-9d77c20a-872f-4b7b-ae9b-13d81c0a2163

  Object.extractError (node_modules/aws-sdk/lib/protocol/json.js:51:27)
  Request.extractError (node_modules/aws-sdk/lib/protocol/rest_json.js:52:8)
  Request.callListeners (node_modules/aws-sdk/lib/sequential_executor.js:106:20)
  Request.emit (node_modules/aws-sdk/lib/sequential_executor.js:78:10)
  Request.emit (node_modules/aws-sdk/lib/request.js:683:14)
  Request.transition (node_modules/aws-sdk/lib/request.js:22:10)
  AcceptorStateMachine.runTo (node_modules/aws-sdk/lib/state_machine.js:14:12)
  node_modules/aws-sdk/lib/state_machine.js:26:10
  Request.<anonymous> (node_modules/aws-sdk/lib/request.js:38:9)
  Request.<anonymous> (node_modules/aws-sdk/lib/request.js:685:12)
```

The root cause turned out to be this function:

```typescript
function addSnsInvokePermissionsToFunction(
 FunctionName: string,
 RequestTopicArn: string,
 lambda: aws.Lambda
) {
 // Missing "return" on the following line
 lambda
  .addPermission({
   FunctionName,
   Action: "lambda:InvokeFunction",
   Principal: "sns.amazonaws.com",
   StatementId: `${FunctionName}-Invoke`,
   SourceArn: RequestTopicArn
  })
  .promise();
}
```

The function issued a request but did not return the promise, which meant that
the function initialization promise (which includes the return value of this
promise) returned before the addPermission request was complete. In the test
case above, there is no execution and a faast function is created and then
cleaned up immediately. The lambda function is therefore deleted before the
addPermission can succeed. It was difficult to debug because the stack trace
only went up to a node timer, not the originating call here.

Ultimately it was found through code review. It could probably be found by
adding a promise return type to this function or by type checking that `await`
doesn't happen on non-promises.

## Layer version difference in aws package test

Error message:

```
  package › remote aws package dependencies with lambda layer caching

  /Users/achou/Code/faast.js/test/package.test.ts:50

   49:         t.not(cloudFunc.state.resources.layer, undefined);
   50:         t.deepEqual(cloudFunc.state.resources.layer, cloudFunc2.state.resources.layer);
   51:         await cloudFunc2.cleanup();

  Difference:

    {
      LayerName: 'faast-5aac4dc1700793c5552ef4df2d705616ff8f63a42e985aa89d67c78c15f3a61e',
  -   LayerVersionArn: 'arn:aws:lambda:us-west-2:343675226624:layer:faast-5aac4dc1700793c5552ef4df2d705616ff8f63a42e985aa89d67c78c15f3a61e:41',
  +   LayerVersionArn: 'arn:aws:lambda:us-west-2:343675226624:layer:faast-5aac4dc1700793c5552ef4df2d705616ff8f63a42e985aa89d67c78c15f3a61e:42',
  -   Version: 41,
  +   Version: 42,
    }
```

This was caused by a bug in the packer where it destructively modified the
`packageJson` value. A secondary bug was using a `packageJson` that was the same
used in other tests. The fixed code generates a unique `packageJson`
specifically for this test, with a unique uuid as part of the name to ensure it
never collides with another test. Also ensure that `packageJson` is readonly in
the packer.

The fix was also wrong in using Object.create() to create a new object with the
original `packageJson` as a prototype. This resulted in JSON.stringify not
working on it... the fix was to use `Object.assign`.

## Layer test interference

Tests need to be designed to be independent for execution with Ava, and this can
be tricky in some cases.

The following error occurred:

```
aws-gc › remote aws garbage collector works for packageJson (lambda layers)
 /codebuild/output/src028605080/src/github.com/acchou/faast.js/test/aws-gc.test.ts:210
 209: }
 210: t.truthy(layerDeletionRecord);
 211: }
 Value is not truthy:
 undefined
 layerDeletionRecord
 => undefined
```

In addition there was this console message earlier in the test:

```
AWS garbage collection test failure: Could not find deletion record for layer { LayerName: 'faast-c4e27de2-b6a1-4c8a-9899-69c454a12e74',
 LayerArn:
 'arn:aws:lambda:us-west-2:547696317263:layer:faast-c4e27de2-b6a1-4c8a-9899-69c454a12e74',
 LatestMatchingVersion:
 { LayerVersionArn:
 'arn:aws:lambda:us-west-2:547696317263:layer:faast-c4e27de2-b6a1-4c8a-9899-69c454a12e74:1',
 Version: 1,
 Description:
 'faast packageJson layer with LayerName faast-c4e27de2-b6a1-4c8a-9899-69c454a12e74',
 CreatedDate: '2019-03-07T14:50:53.996+0000',
 CompatibleRuntimes: [ 'nodejs' ],
 LicenseInfo: null } }, version { LayerVersionArn:
 'arn:aws:lambda:us-west-2:547696317263:layer:faast-c4e27de2-b6a1-4c8a-9899-69c454a12e74:1',
 Version: 1,
 Description:
 'faast packageJson layer with LayerName faast-c4e27de2-b6a1-4c8a-9899-69c454a12e74',
 CreatedDate: '2019-03-07T14:50:53.996+0000',
 CompatibleRuntimes: [ 'nodejs' ],
 LicenseInfo: null }
```

The root cause was that the aws-gc lambda layers test was incorrectly looking at
_all_ layer resources to determine if they had been caught by the garbage
collector. But this is incorrect; the principle of the test is to check that the
resources created _only_ by the prior faast call in the test has its resources
recorded as garbage collected. By enumerating all cloud resources, we detected
layers created during the parallel execution of the other tests, which has some
tests which delete layers on their own, which are created _after_ garbage
collection is done. This causes the test to fail, claiming gc was missing a
resource.

## Nonexistent queue warning

This occurs sometimes when running the cost-analyzer-aws example:

```
(node:58286) UnhandledPromiseRejectionWarning: AWS.SimpleQueueService.NonExistentQueue: The specified queue does not exist for this wsdl version.
    at Request.extractError (/Users/achou/Code/faast.js/node_modules/aws-sdk/lib/protocol/query.js:50:29)
    at Request.callListeners (/Users/achou/Code/faast.js/node_modules/aws-sdk/lib/sequential_executor.js:106:20)
    at Request.emit (/Users/achou/Code/faast.js/node_modules/aws-sdk/lib/sequential_executor.js:78:10)
    at Request.emit (/Users/achou/Code/faast.js/node_modules/aws-sdk/lib/request.js:683:14)
    at Request.transition (/Users/achou/Code/faast.js/node_modules/aws-sdk/lib/request.js:22:10)
    at AcceptorStateMachine.runTo (/Users/achou/Code/faast.js/node_modules/aws-sdk/lib/state_machine.js:14:12)
    at /Users/achou/Code/faast.js/node_modules/aws-sdk/lib/state_machine.js:26:10
    at Request.<anonymous> (/Users/achou/Code/faast.js/node_modules/aws-sdk/lib/request.js:38:9)
    at Request.<anonymous> (/Users/achou/Code/faast.js/node_modules/aws-sdk/lib/request.js:685:12)
    at Request.callListeners (/Users/achou/Code/faast.js/node_modules/aws-sdk/lib/sequential_executor.js:116:18)
(node:58286) UnhandledPromiseRejectionWarning: Unhandled promise rejection. This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). (rejection id: 1)
(node:58286) [DEP0018] DeprecationWarning: Unhandled promise rejections are deprecated. In the future, promise rejections that are not handled will terminate the Node.js process with a non-zero exit code.
```

The cause is unknown.
