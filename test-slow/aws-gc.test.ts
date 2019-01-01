import { getLogGroupName } from "../src/aws/aws-shared";
import { faastify, AWSLambda } from "../src/faast";
import { sleep } from "../src/shared";
import * as functions from "../test/functions";
import { checkResourcesCleanedUp, getAWSResources, quietly } from "../test/tests";

async function checkLogGroupCleanedUp(func: AWSLambda) {
    const { cloudwatch } = func.state.services;
    const { FunctionName } = func.state.resources;

    const logGroupResult = await quietly(
        cloudwatch
            .describeLogGroups({
                logGroupNamePrefix: getLogGroupName(FunctionName)
            })
            .promise()
    );
    expect(logGroupResult && logGroupResult.logGroups!.length).toBe(0);
}

test(
    "garbage collector works for functions that are called",
    async () => {
        // Idea behind this test: create a cloudified function and make a call.
        // Then call stop() to leave the resources in place. Then create another
        // function and set its retention to 0, and have its garbage collector
        // clean up the first function. Verify the first function's resources
        // are cleaned up, which shows that the garbage collector did its job.
        const cloudFunc = await faastify("aws", functions, "../test/functions");
        const { cloudwatch } = cloudFunc.state.services;
        await new Promise(async resolve => {
            let done = false;
            cloudFunc.functions.hello("gc-test");
            while (!done) {
                await sleep(1000);
                const logResult = await quietly(
                    cloudwatch
                        .filterLogEvents({
                            logGroupName: cloudFunc.state.resources.logGroupName
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

        await cloudFunc.stop();
        const func2 = await faastify("aws", functions, "../test/functions", {
            gc: true,
            retentionInDays: 0
        });

        // Simulate expiration of all log streams
        const { logGroupName } = cloudFunc.state.resources;
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
        await checkResourcesCleanedUp(await getAWSResources(cloudFunc));
        await checkLogGroupCleanedUp(cloudFunc);
    },
    120 * 1000
);

test(
    "garbage collector works for functions that are never called",
    async () => {
        const func = await faastify("aws", functions, "../test/functions");
        await func.stop();
        const func2 = await faastify("aws", functions, "../test/functions", {
            gc: true,
            retentionInDays: 0
        });

        await func2.cleanup();
        await checkResourcesCleanedUp(await getAWSResources(func));
        await checkLogGroupCleanedUp(func);
    },
    90 * 1000
);
