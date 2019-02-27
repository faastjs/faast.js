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

XXX Question: is googleapis included by default?
