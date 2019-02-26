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
