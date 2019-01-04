import { AWSServices, GcWork } from "../src/aws/aws-faast";
import { faastify } from "../src/faast";
import { sleep } from "../src/shared";
import * as functions from "../test/functions";
import { quietly, record, contains } from "../test/tests";
import { logGc } from "../src/log";

test(
    "garbage collector works for functions that are called",
    async () => {
        // Idea behind this test: create a cloudified function and make a call.
        // Then call stop() to leave the resources in place. Then create another
        // function and set its retention to 0, and have its garbage collector
        // clean up the first function. Verify the first function's resources
        // are cleaned up, which shows that the garbage collector did its job.

        const gcRecorder = record(async (_: AWSServices, work: GcWork) => {
            logGc(`Recorded gc work: %O`, work);
        });
        const func = await faastify("aws", functions, "../test/functions");
        const { cloudwatch } = func.state.services;
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

        await func.stop();
        const func2 = await faastify("aws", functions, "../test/functions", {
            gcWorker: gcRecorder,
            retentionInDays: 0
        });

        // Simulate expiration of all log streams
        const { logGroupName } = func.state.resources;
        const logStreamsResponse = await quietly(
            cloudwatch.describeLogStreams({ logGroupName }).promise()
        );
        const logStreams = (logStreamsResponse && logStreamsResponse.logStreams) || [];
        for (const { logStreamName } of logStreams) {
            if (logStreamName) {
                await cloudwatch
                    .deleteLogStream({ logGroupName, logStreamName })
                    .promise();
            }
        }
        await func2.cleanup();
        // Don't expect roles or subscriptions to be gc'd. The main role is a singular resource that is cached across runs and doesn't change. The subscription is removed by AWS asynchronously (after days or more) automatically after the request queue topic is deleted. The response queue ARN is redundant with the response queue URL, which is the identifier used for deletion.
        const {
            RoleName,
            SNSLambdaSubscriptionArn,
            ResponseQueueArn,
            ...resources
        } = func.state.resources;
        expect(
            gcRecorder.recordings.find(
                r =>
                    r.args[1].type === "DeleteResources" &&
                    contains(r.args[1].resources, resources)
            )
        ).toBeDefined();
        await func.cleanup();
    },
    120 * 1000
);

test(
    "garbage collector works for functions that are never called",
    async () => {
        const gcRecorder = record(async (_: AWSServices, _work: GcWork) => {});

        const func = await faastify("aws", functions, "../test/functions");
        await func.stop();
        const func2 = await faastify("aws", functions, "../test/functions", {
            gcWorker: gcRecorder,
            retentionInDays: 0
        });

        await func2.cleanup();
        // const resources = await getAWSResources(func);
        const {
            RoleName, // cached
            SNSLambdaSubscriptionArn, // async deleted by aws itself
            ResponseQueueArn, // redundant with response queue url
            ...resources
        } = func.state.resources;

        expect(
            gcRecorder.recordings.find(
                r =>
                    r.args[1].type === "DeleteResources" &&
                    contains(r.args[1].resources, resources)
            )
        ).toBeDefined();
        await func.cleanup();
    },
    90 * 1000
);
