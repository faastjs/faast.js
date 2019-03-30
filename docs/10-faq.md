---
id: faq
hide_title: true
---

# FAQ

**If faast.js creates a new Lambda and other stuff every time it runs, won't I run into AWS limits?**

Cloud providers place limits on resources such as log space, number of functions, and many other resources. faast.js ensures that garbage is cleaned up automatically, so you don't run into cloud provider resource limits unexpectedly. It does so through the cleanup function which you can run manually to clean up resources you just created, and also by running a garbage collector to delete resources that are left behind by other faast.js instances.

**What if my code crashes or terminates the process?**

Even if your code crashes, the resources faast.js created will be automatically cleaned up when faast.js runs next and the retention period has elapsed (24h by default). This assumes that your process doesn't repeatedly crash before garbage collection can complete. To manually clean up resources, you can run `npx faastjs cleanup`.

**Can I run multiple faast.js jobs at the same time?**

Separate faast.js jobs can be run at the same time and they will create separate infrastructure for each faast.js module. The only thing to be careful about is your [resource limits](https://docs.aws.amazon.com/lambda/latest/dg/limits.html), especially the concurrency level available to your lambda functions. You may need to request a service limit increase from your cloud provider or use separate accounts for different workloads.

**Does faast.js support multiple clouds?**

Faast.js works with AWS and Google Cloud Platform. It can also work with other providers in the "local" provider mode, by simply running on a large cloud compute instance.

**Does faast.js look up prices when providing cost estimates?**

Yes, faast.js dynamically looks up prices from AWS and Google in order to produce accurate cost estimates. Prices are cached locally for 1 day and then refreshed.

**How do you know what pricing tier to use?**

Faast.js always uses the worst-case pricing tier to produce cost estimates. This is often not as inaccurate as it seems:

- Usually the lambda function call duration dominates the cost of faast.js workloads, and there are no usage-based tiers for this cost metric (memory-based tiers are taken into account by faast.js). It is not unusual for this metric to be 90%+ of the cost.

- Often it is only _relative_ pricing that matters, e.g. when selecting a memory size it is not the absolute pricing that matters but the relative cost of choosing one memory size versus another.
