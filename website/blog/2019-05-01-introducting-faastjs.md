---
title: Introducing faast.js
author: Andy Chou
authorURL: http://twitter.com/_achou
authorImageURL: /img/andy.png
---

**What if** you could run a function on a thousand cores in the cloud without messing with security roles, command line tools, manual deployments, managing clusters, and containers? What if you could do in a few lines of code, with zero operational overhead, and leave no trace of infrastructure behind when you're done? And see what it cost in real time?

That's what faast.js does.

<!--truncate-->

I started faast.js because I had some large scale software testing to do. Serverless functions seemed like a good fit because they could spin up 1000 cores to perform the work in parallel, then spin down so there would be no ongoing cost. Even better, all infrastructure would be managed by the cloud provider. It seemed like a dream come true: a giant computer that could scale up and down at will.

But trying to build this on AWS Lambda was challenging:

-   **Complex setup:** Lambda throws you into the deep end with IAM roles, permissions, command line tools, web consoles, and special calling conventions. Lambda and other FaaS are oriented towards an event-based processing model, and not optimized for batch processing.

-   **Primitive package dependency support:** everything had to be packaged up manually in a zip file. Every change to the code or tests would require a manual re-deploy.

-   **Native packages:** common testing tools like puppeteer are supported only if they are compiled specially for Lambda.

-   **Persistent infrastructure:** logs, queues, and functions are left behind in the cloud after a job is complete. These would need to be managed or removed, creating an unnecessary ops burden.

-   **Cost opacity:** allocating more memory to a Lambda function also increases CPU and cost. This makes it hard to judge whether increasing memory will increase cost (because of the higher price) or decrease cost (because the workload finishes faster).

-   **Performance opacity:** bandwidth between Lambda and S3 storage is limited with lower amounts of memory. There are also many rate limits that are not obvious at first glance.

-   **Type safety:** arguments and return values of Lambda functions are not type checked from end to end, making it easy to fall prone to common programming errors.

-   **Offline execution:** being able to develop and debug serverless functions while disconnected can be convenient for developers on the go and while experimenting with rapid code changes.

-   **Developer productivity:** debugging, high quality editor support, and other basic productivity tools are awkward or missing from serverless function development tooling.

-   **Scaling:** while serverless functions are auto-scaling, they don't deal with common batch processing issues like tail latency. For example, if 99.9% of requests finish quickly but the last 0.1% take an extraordinarily long time, the batch process is held up until the stragglers complete.

The vision for faast.js is to make serverless batch processing is as simple as possible while preserving the power of serverless platforms.

## Design principles for faast.js

### Deep interfaces

Faast.js presents a ["deep" interface](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=modularDesign). The main interface to faast.js is a single function, `faast()`:

```typescript
faast("aws", funcs);
```

The only additional thing required is a cloud provider account. That's it!

Each exported function in `funcs` is automatically available for invocation as a serverless function:

![vscode example](assets/vscode-screenshot.png)

On the left we have an ordinary JavaScript module. On the right is the code that invokes these functions in a serverless function. As the developer types `m.functions.`, autocomplete pops up all of the exports from the module. Instant feedback on code changes across the serverless function call boundary makes developing with faast.js exceptionally efficient.

### Ephemeral infrastructure

When `faast()` is invoked, it starts creating the infrastructure it needs:

![faast.js architecture](assets/faastjs-architecture-aws.svg)

The exact infrastructure created depends on the cloud provider and the options you provide. But the beautiful thing is **users of faast.js don't need to manage any of this infrastructure**. You don't even need to run a command to initialize it. Faast.js will automatically create new infrastructure for you on the fly, so there is no "deploy" step with faast.js; every time you invoke `faast()`, code is bundled and infrastructure is deployed.

The benefits of emphemeral infrastructure are many. New faast.js instances will start with a clean slate, without contamination of global variables or local filesystems with data leaked from prior function invocations. New code versions are deployed immediately, reducing the friction of rapid iteration. And multiple instances of the same workflow can be started at the same time without interference.

From a security standpoint, infrastructure that isn't there very long is harder to exploit. Like all serverless platforms, infrastructure patching is handled by the cloud provider. But faast.js goes further because code is re-bundled every time it's deployed. Just keep local package dependencies up to date and you're automatically keeping infrastructure patched. No need to worry about migration and upgrade of long-running services.

When your job is done, call a single cleanup function to remove all the infrastructure that faast.js created. There's even a garbage collector to clean up infrastructure remnants left over from crashes and incomplete cleanup.

Creating and destroying infrastructure repeatedly might seem to be wasteful or slow. But cloud providers have been working for years on making these infrastructure steps faster, and on AWS the infrastructure needed to create a cloud function from scratch can take as little as 2 seconds.

## As easy as serverless batch gets

That's the basics. Check out more in the [documentation](https://faastjs.org/docs/introduction).

You are now free to invoke code in the cloud at any scale you wish, with no hassles. Try it out!

## Use cases

Here are a few ideas to get you started.

-   **Test at scale.** Run 1000 tests in parallel. Go ahead and knock yourself out. Run [headless chrome](https://github.com/GoogleChrome/puppeteer) and grab screenshots of web pages a thousand at a time.

-   **Generate load.** Don't bother setting up a complex load testing environment. Just take request logic, stir with faast.js, and you've got instant load testing infrastructure. Just imagine load testing every checkin... or even have developers load test _before_ they check in...

-   **Process documents and data.** Did you know that you can scatter 1TB of data from S3 to Lambda functions in under 40 seconds _for free_? Run transformations, analysis, ETL, and other workloads faster, and do it with no operational overhead.

-   **Process images.** Make light work of resizing pantloads images. Boatloads of images. [Sharp](https://github.com/lovell/sharp) and other native image processing libraries can be used with minimal hassle with faast.js.

This is just the tip of the iceberg. We can't wait to see what you do with faast.js!

If you'd like to discuss faast.js ideas or issues, join our [slack channel](https://join.slack.com/t/faastjs/shared_invite/enQtNTk0NTczMzI4NzQxLTA2MWU1NDA1ZjBkOTc3MTNkOGMzMDY0OWU1NGQ5MzM2NDY1YTJiZmNmODk4NzI0OWI1MzZhZDdiOTIzODNkOGY). Also check out our [website](https://faastjs.org), [docs](https://faastjs.org/docs/introduction), and [github repository](https://github.com/faastjs/faast.js).

## Up next

In my next blog post, I'll cover how faast.js helps understand and optimize cloud costs.
