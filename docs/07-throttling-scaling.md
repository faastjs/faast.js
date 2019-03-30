---
id: throttling-scaling
hide_title: true
---

# Scaling and Throttling faast.js

Running programs at scale introduce new issues. This topic covers some of these issues.

## Cloud provider limits

AWS Lambda has documented [limits](https://docs.aws.amazon.com/lambda/latest/dg/limits.html). In particular, the default concurrency limit for lambda invocations is 1000 per account. This limit can be increased by request.

Google Cloud Functions has several [quotas](https://cloud.google.com/functions/quotas).

## Tail latency

When running hundreds or thousands of requests, it is not uncommon that a small number of requests hit a bottleneck, such as network congestion or storage system lags. If even 0.1% of requests takes a very long time, then a job with 1000 concurrent invocations can be held up even if almost all of the work is finished.

There has been written about [tail latency](https://ai.google/research/pubs/pub40801). Faast.js has an automatic retry mechanism that attempts to reduce tail latency. See [`speculativeRetryThreshold`](./api/faastjs.commonoptions.speculativeretrythreshold.md).

There are other simple ways of mitigating tail latency:

- Proceed with partial results once the number of successful requests exceeds some threshold, such as 99%.

- Retry invocations that are not completed by a certain timeout.

## Throttling

It is very common in serverless applications to interact with other services which are not auto-scaling. For example, if the output of your serverless function invocations need to go into a database, the database might not be able to keep up with the write requests from thousands of concurrent invocations. Another example is a rate limited external API.

Faast.js contains a [`throttle`](./api/faastjs.throttle.md) function to help in these situations. `throttle` makes it easy to limit concurrency and request rate. See [`Limits`](./api/faastjs.limits.md).
