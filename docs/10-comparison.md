---
id: comparison
title: faast.js vs other
hide_title: true
---

# How faast.js compares with other tools

There are so many tools and platforms, it can be hard to tell them apart.

Faast.js is a self-contained library with no dependency on an external service. There is no third party whose uptime limits your ability to develop and run your code.

Here's how faast.js compares with different categories:

## faast.js vs infrastructure-as-code platforms

Infrastructure-as-code encompasses products such as AWS CloudFormation, Terraform, and Pulumi. These products allow declarative specification of cloud resources in the form of configuration files or code. Then the tool can compare the declared infrastructure with the state of the actual system and create, modify, or remove resources to bring infrastructure state into alignment with the specification.

Infrastructure-as-code platforms are powerful and expressive. They tend to work best when infrastructure is intended to be "always on" or at least "always setup" and ready to go. Faast.js is designed for a different use case, where having always on infrastructure can be an unnecessary burden, and having to create a different "stack" for each instantiation of an infrastructure is more of an overhead than a help. Performance and cost are other dimensions which infrastructure as code platforms don't optimize; these platforms manage the creation and updating of cloud resources, but which resources to create and how to effectively integrate them together is left up to you.

In contrast, faast.js is specialized for emphemeral batch computing and makes this use case exceptionally convenient, and has runtime code that has been tuned specifically for the infrastructure it creates for itself. Because it knows the infrastructure it's going to create, faast.js can do things that infrastructure as code providers can't:

-   Immediate cost feedback on a specific workload
-   Adaptive queueing logic that understands how much concurrency to use to pull results
-   Type safety for cloud function call arguments and return values.
-   Automatically packaging up dependencies.
-   Automatic creation of lambda layers for faster function startup and larger code package size.
-   Automatic creation of roles, queues, and subscriptions connected to cloud functions.
-   etc.

The end result is that faast.js has a simpler, more performant abstraction that allows developers to worry less about infrastructure details.

On the other hand, infrastructure-as-code platforms might be a better fit for:

-   Event-based systems that remain up on a permanent basis.
-   Precise control of which resources are created and how they're named.
-   Systems where control needs to pass directly from one service to another, without control passing through a central node.

## faast.js vs. serverless abstraction platforms

Platforms such as Serverless and stdlib can be considered a somewhat specialized form of infrastructure as code that's dedicated mainly to serverless platforms. These platforms allow you to abstract over your provider (which faast.js also allows in limited form), and ease deployment and packaging much as faast.js. Where they begin to differ is faast.js' focus on batch processing applications and ephemeral infrastructure. There is some overlap in functionality, but a simple rule of thumb is that faast.js applies to batch processing and serverless abstraction platforms are better when you need an event-based system that is continually handling requests.

## faast.js vs. big data platforms

Big data platforms such as Spark and Hadoop are geared towards large scale data processing, an area where faast.js can also be useful. Compared with these platforms:

-   faast.js has no specific support for high-level queries at this time.
-   faast.js focuses on JavaScript / TypeScript, which have limited support on these platforms.
-   faast.js is serverless does not have the notion of a cluster to set up and manage.

Faast.js provides a simple abstraction of serverless functions, not a complete data processing system. For data processing applications where big data platforms apply, they have more complete functionality. But there are other use cases faast.js can handle beyond data processing, such as dealing with semi-structured or unstructured data, software testing, or load generation.
