---
id: errors
title: Errors
hide_title: true
---

# Errors seen while developing

A catalogue of common error messages and their root causes. Some of these errors are specific to the faast.js testsuite, but other errors may be encountered by users.

## Connection timed out after 120000ms

This error was observed when developing another application that uses faast.js. The symptoms of the problem included mysterious "phantom" retries that were not initiated by faast.js itself, nor by the application. Different errors were observed, including the following:

_SQS: nonexistent queue warning_
(node:58286) UnhandledPromiseRejectionWarning: AWS.SimpleQueueService.NonExistentQueue: The specified queue does not exist for this wsdl version.

_Connection timed out after 120000ms_
An exception was thrown with this error from the lambda invoke api in https mode.

_Extra output files_
Output files that were deleted were still present at the end of a batch run.

The diagnosis ended up pointing to an interaction between two AWS node.js API configuration settings:

```
awsconfig.update({ maxRetries: 6 });
```

In faast.js we set AWS apis to automatically retry up to 6 times. This helps with robustness in making calls, especially in the CI testsuite where many API calls are happening in parallel and there are some implicit dependencies, such as creating a role before using it in creating a lambda function.

Unfortunately this also applies to lambda's `invoke` API, which calls serverless functions. However, retries are only attempted for errors at the AWS api level, not the userspace code level. AWS's [documentation on retries](https://docs.aws.amazon.com/lambda/latest/dg/invocation-retries.html):

    When you invoke a function directly, you determine the strategy for handling errors. You can retry, send the event to a queue for debugging, or ignore the error. Your function's code might have run completely, partially, or not at all. If you retry, ensure that your function's code can handle the same event multiple times without causing duplicate transactions or other unwanted side effects.

Invoking a function directly means using faast.js' `https` mode, which uses the `invoke` API call. This makes it sound like Lambda won't automatically retry. However, the documentation also states:

    When you invoke a function, two types of error can occur. Invocation errors occur when the invocation request is rejected before your function receives it. Function errors occur when your function's code or runtime returns an error. Depending on the type of error, the type of invocation, and the client or service that invokes the function, the retry behavior and the strategy for managing errors varies.
    ...
    Clients such as the AWS CLI and the AWS SDK retry on client timeouts, throttling errors (429), and other errors that aren't caused by a bad request (500 series). For a full list of invocation errors, see [Invoke](https://docs.aws.amazon.com/lambda/latest/dg/API_Invoke.html).

This sounds reasonable but there is one pitfall not specifically mentioned: there is an http connection timeout that defaults to 120s, and it is one of the errors that causes the sdk to retry.

This implies that by default, when invoking via the `invoke` api, any function that takes longer than 120s to respond will cause a client connection timeout, which triggers retries, all of which will probably fail due to the same timeout. The only reason faas.js seemed to have successful results was that we don't rely on the http connection to return results; they are returned via an SQS queue.

The solution is to modify the https timeout:

```
awsconfig.update({
    maxRetries: 6,
    httpOptions: { timeout: 0 }
});
```

This ensures that there will be no client-side connection timeout within the time that the lambda function has to run. The errors above can be explained as follows:

SQS nonexistent queue - retries that were started continued to run after faast.js deleted the response queue upon cleanup. When the retry invocations tried to return results via the response queue, the queue name was no longer valid.

Connection timed out after 120s - this was the error from the AWS SDK, the exception was thrown when a function exceeded the max retry count.

Extra output files - multiple retry attempts were putting output files in S3.

Note that the 0 timeout means no timeout, and is only applicable to the Lambda instance used with the `invoke` API call. Other AWS service calls are not affected. Also note that Lambda will automatically cut off the connection after it exceeds the maximum lambda execution timeout, so there is no chance of an infinite hang here.

## Cannot find any-observable

This error was observed when developing another application that uses faast.js:

```
`lambda execution error: {"errorType":"Error","errorMessage":"Cannot find any-observable implementation nor global.Observable. You must install polyfill or call require(\\"any-observable/register\\") with your preferred implementation, e.g. require(\\"any-observable/register\\")('rxjs') on application load prior to any require(\\"any-observable\\").","trace":["Error: Cannot find any-observable implementation nor global.Observable. You must install polyfill or call require(\\"any-observable/register\\") with your preferred implementation, e.g. require(\\"any-observable/register\\")('rxjs') on application load prior to any require(\\"any-observable\\")."," at loadImplementation (webpack:///./node_modules/any-observable/register.js?:29:9)"," at eval (webpack:///./node_modules/any-observable/loader.js?:30:18)"," at eval (webpack:///./node_modules/any-observable/index.js?:2:100)"," at Object../node_modules/any-observable/index.js (/var/task/index.js:4784:1)"," at __webpack_require__ (/var/task/index.js:27:30)"," at eval (webpack:///./node_modules/@samverschueren/stream-to-observable/index.js?:2:20)"," at Object../node_modules/@samverschueren/stream-to-observable/index.js (/var/task/index.js:3289:1)"," at __webpack_require__ (/var/task/index.js:27:30)"," at eval (webpack:///./node_modules/listr/lib/task.js?:3:28)"," at Object../node_modules/listr/lib/task.js (/var/task/index.js:26916:1)"]}`
```

The root cause was trying to import faast.js into the remote module (indirectly). In particular, a utility function was importing `FaastError` and `FaastErrorNames` to check for timeouts. This utility code was shared between local and remote sides, because it dealt with low-level async operations. When faast.js was imported, it pulled in many dependencies during webpack processing, some of which were not using only static imports.

The solution was to move one utility function out of the shared module and into a purely local file. This removed the indirect dependency on faast.js in the remote module.

Faast.js should probably detect this situation and warn about it explicitly.

## Google cloud permissions error

```text
 Permission \'cloudfunctions.functions.setIamPolicy\' denied on resource \'projects/derivative-184723/locations/us-central1/functions/faast-cf84d703-64bb-465e-809d-0a39f36f4d9b\' (or resource may not exist).
```

In March 2020 Google changed the permissions model for cloud functions to disallow cloud functions to be called by unauthenticated users by default. Faast.js created cloud functions are intended to be ephemeral, and are named using a sha256 hash, so unauthorized calls are very unlikely. Therefore faast.js sets the IAM policy for the cloud functions it creates to allow invocations for all users from anywhere -- until they are deleted of course.

The error above occurs if the user or service account used with faast.js doesn't have Owner permissions. Editor permissions are not sufficient; Owner permissions are required to be able to invoke setIamPolicy in the google cloud functions API.

## AWS IAM role permissions problems

A constellation of errors can occur with AWS IAM roles:

```text
Lambda was unable to decrypt the environment variables due to an internal service error.
```

```text
The provided execution role does not have permissions to call SendMessage on SQS
```

```text
AccessDeniedException: The role defined for the function cannot be assumed by Lambda.
```

These all occurred in the following scenario:

(1) the CLI was used to run cleanup, removing all faast.js resources including the cached IAM role.

(2) A large number of serverless functions were created in parallel (e.g. with the testsuite).

(3) Each of these functions attempted to create the IAM role; when some detected the role already existed, they proceeded as-if the role had a policy attached already and propagated.

(4) Even the AWS IAM API returns that it believes the IAM role has the currect policy attached, but it hasn't propagated across all of AWS.

(5) Lambda functions are created assuming the role's permissions are set correctly. But they aren't so the functions fail when invoked, with one of the mysterious errors above.

This should be a relatively rare occurrence, unless the cleanup command is used regularly to remove the cached IAM role (creating the role should be a one-time event, if the cleanup script is not used).

This issue has been fixed. The solution is to test if the role was recently created (within the last 2min). If so, then invoke the lambda function after creating it, in order to test that the permissions are correct. If the invocation fails, then delete the lambda and retry deployment. This procedure is necessary because once a lambda is created with a role whose policy has not been propagated, the lambda continues to issue errors even after retrying invocations or waiting for a long period of time; the lambda deployment should be considered bad in this case. Therefore deleting the function and re-deploying is the way forward, and empirically this makes function creation very reliable.

## Error with permissions on Google Cloud

This error occurs after setting the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to point to a service account with Owner permissions, which should be enough:

```text
(node:83956) UnhandledPromiseRejectionWarning: Error: The caller does not have permission
    at Gaxios.<anonymous> (/Users/achou/Code/faast.js/node_modules/gaxios/src/gaxios.ts:74:15)
    at Generator.next (<anonymous>)
    at fulfilled (/Users/achou/Code/faast.js/node_modules/gaxios/build/src/gaxios.js:16:58)
    at processTicksAndRejections (internal/process/next_tick.js:81:5)
(node:83956) UnhandledPromiseRejectionWarning: Unhandled promise rejection. This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). (rejection id: 1)
(node:83956) [DEP0018] DeprecationWarning: Unhandled promise rejections are deprecated. In the future, promise rejections that are not handled will terminate the Node.js process with a non-zero exit code.
```

The problem was that the environment variable `GCLOUD_PROJECT` was also set, to a different project. So the key was for the wrong project. The solution is to unset the `GCLOUD_PROJECT` variable, and get the project from the key (happens automatically in faast.js). See https://github.com/googleapis/google-auth-library-nodejs/blob/master/src/auth/googleauth.ts.

## Error instantiating faast.js with Google Cloud

This error message can occur if the create function parameters are incorrect:

```text
  faast:warning createFunction error: Error: The request has errors
  faast:warning     at Gaxios.<anonymous> (/Users/achou/Code/faast.js/node_modules/gaxios/build/src/gaxios.js:72:27)
  faast:warning     at Generator.next (<anonymous>)
  faast:warning     at fulfilled (/Users/achou/Code/faast.js/node_modules/gaxios/build/src/gaxios.js:16:58)
  faast:warning     at processTicksAndRejections (internal/process/next_tick.js:81:5) +0ms
  faast:warning faast: createFunction error: Error: The request has errors +441ms
(node:62580) UnhandledPromiseRejectionWarning: Error: The request has errors
    at Gaxios.<anonymous> (/Users/achou/Code/faast.js/node_modules/gaxios/build/src/gaxios.js:72:27)
    at Generator.next (<anonymous>)
    at fulfilled (/Users/achou/Code/faast.js/node_modules/gaxios/build/src/gaxios.js:16:58)
    at processTicksAndRejections (internal/process/next_tick.js:81:5)
(node:62580) UnhandledPromiseRejectionWarning: Unhandled promise rejection. This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). (rejection id: 1)
(node:62580) [DEP0018] DeprecationWarning: Unhandled promise rejections are deprecated. In the future, promise rejections that are not handled will terminate the Node.js process with a non-zero exit code.
```

Some common reasons for this include:

-   Specifying an incorrect google cloud region
-   Specifying a memory size that google cloud functions does not support.

Unfortunately google cloud's error message is vague about the cause.

## Error importing puppeteer

The following error occurs when trying to use puppeteer:

```text
  faast:warning createPackageLayer error: +0ms
  faast:warning Error: Could not initialize cloud function
  faast:warning     at exports.initialize.throttle_1.throttle (/Users/achou/Code/faast.js/dist/src/aws/aws-faast.js:275:26)
  faast:warning     at processTicksAndRejections (internal/process/next_tick.js:81:5) +1ms
  faast:warning Underlying error: InvalidParameterValueException: Unzipped size must be smaller than 262144000 bytes
  faast:warning     at Object.extractError (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/protocol/json.js?:51:27)
  faast:warning     at Request.extractError (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/protocol/rest_json.js?:52:8)
  faast:warning     at Request.callListeners (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/sequential_executor.js?:106:20)
  faast:warning     at Request.emit (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/sequential_executor.js?:78:10)
  faast:warning     at Request.emit (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/request.js?:683:14)
  faast:warning     at Request.transition (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/request.js?:22:10)
  faast:warning     at AcceptorStateMachine.runTo (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/state_machine.js?:14:12)
  faast:warning     at eval (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/state_machine.js?:26:10)
  faast:warning     at Request.eval (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/request.js?:38:9)
  faast:warning     at Request.eval (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/request.js?:685:12) +1ms
  faast:warning faast: createFunction error: InvalidParameterValueException: Unzipped size must be smaller than 262144000 bytes +609ms
(node:18317) UnhandledPromiseRejectionWarning: InvalidParameterValueException: Unzipped size must be smaller than 262144000 bytes
    at Object.extractError (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/protocol/json.js?:51:27)
    at Request.extractError (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/protocol/rest_json.js?:52:8)
    at Request.callListeners (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/sequential_executor.js?:106:20)
    at Request.emit (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/sequential_executor.js?:78:10)
    at Request.emit (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/request.js?:683:14)
    at Request.transition (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/request.js?:22:10)
    at AcceptorStateMachine.runTo (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/state_machine.js?:14:12)
    at eval (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/state_machine.js?:26:10)
    at Request.eval (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/request.js?:38:9)
    at Request.eval (webpack:////Users/achou/Code/faast.js/node_modules/aws-sdk/lib/request.js?:685:12)
(node:18317) UnhandledPromiseRejectionWarning: Unhandled promise rejection. This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). (rejection id: 5)
(node:18317) [DEP0018] DeprecationWarning: Unhandled promise rejections are deprecated. In the future, promise rejections that are not handled will terminate the Node.js process with a non-zero exit code.
```

The cause is that puppeteer downloads a copy of chrome which exceeds Lambda's [maximum unzipped code package size of 250MB](https://docs.aws.amazon.com/lambda/latest/dg/limits.html).

The solution is to use `puppeteer-core` and `chrome-aws-lambda`. See the [faastjs/examples repository](https://github.com/faastjs/examples), specifically the `aws-puppeteer-ts` example.

## Error importing `sharp` package

This error occurs if you try to import `sharp`, a native dependency, in your cloud function without using `packageJson`:

```text
(node:19630) UnhandledPromiseRejectionWarning: Error: {"errorMessage":"Cannot read property 'indexOf' of undefined","errorType":"TypeError","stackTrace":["bindings (webpack:///./node_modules/bindings/bindings.js?:82:48)","Object.eval (webpack:///./node_modules/sharp/lib/constructor.js?:10:89)","eval (webpack:///./node_modules/sharp/lib/constructor.js?:243:30)","Object../node_modules/sharp/lib/constructor.js (/var/task/index.js:560:1)","__webpack_require__ (/var/task/index.js:21:30)","eval (webpack:///./node_modules/sharp/lib/index.js?:3:15)","Object../node_modules/sharp/lib/index.js (/var/task/index.js:572:1)","__webpack_require__ (/var/task/index.js:21:30)","eval (webpack:///./dist/functions.js?:11:15)"]}
    at invokeHttps (/Users/achou/Code/faast.js/dist/src/aws/aws-faast.js:327:20)
    at processTicksAndRejections (internal/process/next_tick.js:81:5)
(node:19630) UnhandledPromiseRejectionWarning: Unhandled promise rejection. This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). (rejection id: 2)
(node:19630) [DEP0018] DeprecationWarning: Unhandled promise rejections are deprecated. In the future, promise rejections that are not handled will terminate the Node.js process with a non-zero exit code.
```

The error message may vary for different packages, in this case note the stack trade reference to `Object../node_modules/sharp/lib/constructor.js`.

Solution: use `packageJson` for package dependencies with native components.

## Cloud Billing API has not been used in project `<N>` before or it is disabled.

Google requires enabling the Cloud Billing API before use. See [Google setup instructions](./05-google-cloud.md#setup).

## [testsuite] Google Cloud: Invalid JWT

This error occurred when running the cancellation test on google cloud:

```text
  faast:warning Could not get Google Cloud Functions pricing +0ms
  faast:warning Error: invalid_grant: Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. Check your iat and exp values and use a clock with skew to account for clock differences between systems.
  faast:warning     at Gaxios.<anonymous> (/home/circleci/repo/node_modules/gaxios/src/gaxios.ts:74:15)
  faast:warning     at Generator.next (<anonymous>)
  faast:warning     at fulfilled (/home/circleci/repo/node_modules/gaxios/build/src/gaxios.js:16:58)
  faast:warning     at process._tickCallback (internal/process/next_tick.js:68:7) +0ms
  faast:warning faast: createFunction error: Error: invalid_grant: Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. Check your iat and exp values and use a clock with skew to account for clock differences between systems. +2s
  ✖ cancellation › remote google cleanup waits for all async operations to complete before returning { mode: 'https', childProcess: true } Rejected promise returned by test
  faast:warning Could not get Google Cloud Functions pricing +-2s
  faast:warning Error: invalid_grant: Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. Check your iat and exp values and use a clock with skew to account for clock differences between systems.
  faast:warning     at Gaxios.<anonymous> (/home/circleci/repo/node_modules/gaxios/src/gaxios.ts:74:15)
  faast:warning     at Generator.next (<anonymous>)
  faast:warning     at fulfilled (/home/circleci/repo/node_modules/gaxios/build/src/gaxios.js:16:58)
  faast:warning     at process._tickCallback (internal/process/next_tick.js:68:7) +0ms
  faast:warning faast: createFunction error: Error: invalid_grant: Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. Check your iat and exp values and use a clock with skew to account for clock differences between systems. +1s
  ✖ cancellation › remote google cleanup waits for all async operations to complete before returning { mode: 'queue', childProcess: true } Rejected promise returned by test

  Unhandled rejection in dist/test/cancellation.test.js

  /home/circleci/repo/node_modules/gaxios/src/gaxios.ts:74

  Error: invalid_grant: Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. Check your iat and exp values and use a clock with skew to account for clock differences between systems.
```

The problem arose when modifying the cancellation test to use a virtual clock via lolex, from the call to `withClock()`. The virtual clock caused JS Date API to return 0 for Date.now(), which caused google's gaxios to send a time that google's server rejects because of excessive clock skew. The solution was to set the virtual time to start at the current system time: `Date.now()`.

## [testsuite] Failure in AWS basic calls with packageJson

Error message:

```text
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

## [testsuite] Testsuite timeout

A testsuite timeout looks like this:

```text
 ✖ Timed out while running tests
```

In addition there will be messages from the Ava test framework about various tests that are pending. First, understand that Ava's timeout is different from other test frameworks. Instead of being a test-specific timeout, the timeout specifies the amount of time "between" test completion events. The goal for Ava is to detect a testsuite that is stalled, not to measure performance of a specific test. This is because Ava runs tests concurrently, and the time taken by each test will be highly variable depending on the other async operations in progress.

Also confusing is that Ava will claim certain tests are pending that should not run at all. For example, on the Google testsuite Ava may say there are AWS tests pending, even though they are filtered out and not supposed to run at all:

```text
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

```text
Step #2: 2 tests were pending in /workspace/build/test/cost.test.js
Step #2:
Step #2: ◌ cost › remote aws cost analyzer
Step #2: ◌ cost › remote google cost analyzer
```

## [testsuite] unit-package google package test error

Error message:

```text
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

## [testsuite] Unhandled rejection error

This was a mysterious one:

```text
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

The function issued a request but did not return the promise, which meant that the function initialization promise (which includes the return value of this promise) returned before the addPermission request was complete. In the test case above, there is no execution and a faast function is created and then cleaned up immediately. The lambda function is therefore deleted before the addPermission can succeed. It was difficult to debug because the stack trace only went up to a node timer, not the originating call here.

Ultimately it was found through code review. It could probably be found by adding a promise return type to this function or by type checking that `await` doesn't happen on non-promises.

## [testsuite] Layer version difference in aws package test

Error message:

```text
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

This was caused by a bug in the packer where it destructively modified the `packageJson` value. A secondary bug was using a `packageJson` that was the same used in other tests. The fixed code generates a unique `packageJson` specifically for this test, with a unique uuid as part of the name to ensure it never collides with another test. Also ensure that `packageJson` is readonly in the packer.

The fix was also wrong in using Object.create() to create a new object with the original `packageJson` as a prototype. This resulted in JSON.stringify not working on it... the fix was to use `Object.assign`.

## [testsuite] Layer test interference

Tests need to be designed to be independent for execution with Ava, and this can be tricky in some cases.

The following error occurred:

```text
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

```text
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

The root cause was that the aws-gc lambda layers test was incorrectly looking at _all_ layer resources to determine if they had been caught by the garbage collector. But this is incorrect; the principle of the test is to check that the resources created _only_ by the prior faast call in the test has its resources recorded as garbage collected. By enumerating all cloud resources, we detected layers created during the parallel execution of the other tests, which has some tests which delete layers on their own, which are created _after_ garbage collection is done. This causes the test to fail, claiming gc was missing a resource.

## [testsuite] Nonexistent queue warning

This occurs sometimes when running the cost-analyzer-aws example:

```text
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

This was caused by the following line of code:

```typescript
sqs.deleteMessageBatch({
    QueueUrl: ResponseQueueUrl!,
    Entries: Messages.map(m => ({
        Id: m.MessageId!,
        ReceiptHandle: m.ReceiptHandle!
    }))
}).promise();
```

The issue is the `.promise()` does not have a `catch()` handler for the error case. This line was deliberately not `await`ed, because it occurs when acknowledging received messages from the response queue. There is no reason to hold up the response messages being sent back to the caller while the messages are being acknowledged (deleted) from the queue. So there was a naked promise with no await, and no catch.

This is actually ok - but there is a potential race condition where the faast.js instance is deleted, causing the response queue to be deleted, while the ack is still executing. In this case, the promise might reject with the observed error: the queue is indeed nonexistent, because we deleted it!

IT is harmless to ignore this error because queue deletion also deletes any messages left in the queue, so we suppress with an empty catch clause:

```typescript
sqs.deleteMessageBatch({
    QueueUrl: ResponseQueueUrl!,
    Entries: Messages.map(m => ({
        Id: m.MessageId!,
        ReceiptHandle: m.ReceiptHandle!
    }))
})
    .promise()
    .catch(_ => {});
```

This closes a longstanding mysterious error message that occurs in the testsuite.

## [testsuite] Create function request failure: The destination ARN arn:aws:sqs:us-west-2:547696317263:faast-88e9096f-28ec-4ca7-8c7f-8f3b98340e8c-Responses is invalid.'

This error occurs occassionally in the testsuite. It's likely caused by a rare race condition on the AWS side where an SQS queue is successfully created, but not yet available for adding as a function invocation configuration destination. Resolved by adding retry in case of this specific error message when putting function invocation configuration.

## Cleanup script: MalformedXML: The XML you provided was not well-formed or did not validate against our published schema

This error occurs on trying to delete S3 bucket objects with the s3.deleteObjects API with 0 keys to delete. This is counter to Ousterhout's advice in [A Philosophy of Software Design](https://www.amazon.com/Philosophy-Software-Design-John-Ousterhout/dp/1732102201) to define errors away when possible. There are two sins here: (1) a very obscure error message for a very simple error, and (2) not choosing to design the error away by simply claiming success when there are no keys to delete. This is reminiscent of the example in the book re: unix vs Windows file deletion semantics.

Fixed by not attempting to call deleteObjects when there are no keys to delete.
