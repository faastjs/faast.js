import test from "ava";
import { CloudWatchLogs } from "aws-sdk";
import * as uuid from "uuid/v4";
import { faast, faastAws, log } from "../index";
import { AwsGcWork, AwsServices } from "../src/aws/aws-faast";
import * as functions from "./fixtures/functions";
import { contains, quietly, record, sleep } from "./fixtures/util";

test.serial(
    "remote aws garbage collector works for functions that are called",
    async t => {
        // Idea behind this test: create a faast function and make a call. Then
        // cleanup while leaving the resources in place. Then create another
        // function and set its retention to 0, and use a recorder to observe
        // its garbage collector to verify that it would clean up the first
        // function, which shows that the garbage collector did its job.

        const gcRecorder = record(async (work: AwsGcWork) => {
            log.gc(`Recorded gc work: %O`, work);
        });
        const func = await faastAws(functions, "./fixtures/functions", {
            mode: "queue"
        });
        try {
            const cloudwatch = new CloudWatchLogs();
            await new Promise(async resolve => {
                let done = false;
                func.functions.hello("gc-test");
                while (!done) {
                    await sleep(1000);
                    const logResult = await quietly(
                        cloudwatch
                            .filterLogEvents({
                                logGroupName: func.state.resources.logGroupName
                            })
                            .promise()
                    );
                    const events = (logResult && logResult.events) || [];
                    for (const event of events) {
                        if (event.message!.match(/REPORT RequestId/)) {
                            resolve();
                            done = true;
                            break;
                        }
                    }
                }
            });

            await func.cleanup({ deleteResources: false });
            const func2 = await faastAws(functions, "./fixtures/functions", {
                gc: true,
                gcWorker: gcRecorder,
                retentionInDays: 0
            });

            // Simulate expiration of all log streams
            const { logGroupName } = func.state.resources;
            const logStreamsResponse = await quietly(
                cloudwatch.describeLogStreams({ logGroupName }).promise()
            );
            const logStreams =
                (logStreamsResponse && logStreamsResponse.logStreams) || [];
            for (const { logStreamName } of logStreams) {
                if (logStreamName) {
                    await cloudwatch
                        .deleteLogStream({ logGroupName, logStreamName })
                        .promise();
                }
            }
            await func2.cleanup();
            // The role name, SNS subscription, and Request Queue ARN are resources
            // that are not garbage collected. The role name is cached between
            // calls. The SNS subscription is deleted by AWS asynchronously
            // (possibly days later) when the SNS topic it's subscribed to is
            // deleted. The Request Queue ARN is redundant information with the
            // Request Queue URL, which is the resource identifier used for deletion
            // of the queue.
            const {
                RoleName,
                SNSLambdaSubscriptionArn,
                ResponseQueueArn,
                ...resources
            } = func.state.resources;

            const deleteResourceRecord = gcRecorder.recordings.find(
                ({ args: [work] }) =>
                    work.type === "DeleteResources" && contains(work.resources, resources)
            );
            if (!deleteResourceRecord) {
                console.log(
                    `AWS garbage collection test failure: Did not find deletion record for %O`,
                    resources
                );
            }
            t.truthy(deleteResourceRecord);
        } finally {
            await func.cleanup();
        }
    }
);

test.serial(
    "remote aws garbage collector works for functions that are never called",
    async t => {
        const gcRecorder = record(async (work: AwsGcWork, _: AwsServices) => {
            log.gc(`Recorded gc work: %O`, work);
        });

        const func = await faastAws(functions, "./fixtures/functions", {
            gc: false,
            mode: "queue"
        });
        try {
            await func.cleanup({ deleteResources: false });
            const func2 = await faastAws(functions, "./fixtures/functions", {
                gc: true,
                gcWorker: gcRecorder,
                retentionInDays: 0
            });

            await func2.cleanup();

            const {
                RoleName,
                SNSLambdaSubscriptionArn,
                ResponseQueueArn,
                ...resources
            } = func.state.resources;

            const deleteResourceRecord = gcRecorder.recordings.find(
                ({ args: [work] }) =>
                    work.type === "DeleteResources" && contains(work.resources, resources)
            );

            if (!deleteResourceRecord) {
                console.log(
                    `AWS garbage collection test failure: Did not find deletion record for %O`,
                    resources
                );
            }
            t.truthy(deleteResourceRecord);
        } finally {
            await func.cleanup();
        }
    }
);

test.serial(
    "remote aws garbage collector works for packageJson (lambda layers)",
    async t => {
        const gcRecorder = record(async (work: AwsGcWork, _: AwsServices) => {
            log.gc(`Recorded gc work: %O`, work);
        });

        const func = await faastAws(functions, "./fixtures/functions", {
            mode: "queue",
            packageJson: {
                name: uuid(),
                version: "0.0.2",
                description: "aws gc layer test",
                repository: "foo",
                license: "ISC",
                dependencies: {
                    tslib: "^1.9.1"
                }
            }
        });
        try {
            await func.cleanup({ deleteResources: false });
            const func2 = await faastAws(functions, "./fixtures/functions", {
                gc: true,
                gcWorker: gcRecorder,
                retentionInDays: 0
            });

            await func2.cleanup();
            const { layer } = func.state.resources;
            if (!layer) {
                t.fail("Initial function did not create Lambda Layer");
                return;
            }
            const layerDeletionRecord = gcRecorder.recordings.find(({ args: [work] }) => {
                return (
                    work.type === "DeleteLayerVersion" &&
                    work.layerName === layer.LayerName &&
                    work.layerVersion === layer.Version
                );
            });
            if (!layerDeletionRecord) {
                console.log(`Could not find deletion record for layer %O`, layer);
            }
            t.truthy(layerDeletionRecord);
        } finally {
            await func.cleanup({ deleteResources: true, deleteCaches: true });
        }
    }
);
