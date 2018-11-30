import * as cloudify from "../src/cloudify";
import { checkResourcesCleanedUp, quietly, getAWSResources } from "../test/util";
import { getLogGroupName } from "../src/aws/aws-shared";
import * as functions from "../test/functions";
import { sleep } from "../src/shared";

async function checkLogGroupCleanedUp(func: cloudify.AWSLambda) {
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
        const cloud = cloudify.create("aws");
        const func = await cloud.createFunction("./functions");
        const remote = func.cloudifyModule(functions);
        const { cloudwatch } = func.state.services;
        await new Promise(async resolve => {
            let done = false;
            remote.hello("gc-test");
            while (!done) {
                await sleep(1000);
                const logResult = await cloudwatch
                    .filterLogEvents({ logGroupName: func.state.resources.logGroupName })
                    .promise();
                for (const event of logResult.events || []) {
                    if (event.message!.match(/REPORT RequestId/)) {
                        resolve();
                        done = true;
                        break;
                    }
                }
            }
        });

        await func.stop();
        const func2 = await cloud.createFunction("./functions", {
            gc: true,
            retentionInDays: 0
        });

        const { logGroupName } = func.state.resources;
        const logStreamsResponse = await cloudwatch
            .describeLogStreams({ logGroupName })
            .promise();
        for (const { logStreamName } of logStreamsResponse.logStreams || []) {
            if (logStreamName) {
                await cloudwatch
                    .deleteLogStream({ logGroupName, logStreamName })
                    .promise();
            }
        }

        await func2.cleanup();
        await checkResourcesCleanedUp(await getAWSResources(func));
        await checkLogGroupCleanedUp(func);
    },
    120 * 1000
);

test(
    "garbage collector works for functions that are never called",
    async () => {
        const cloud = cloudify.create("aws");
        const func = await cloud.createFunction("./functions");
        await func.stop();
        const func2 = await cloud.createFunction("./functions", {
            gc: true,
            retentionInDays: 0
        });

        await func2.cleanup();
        await checkResourcesCleanedUp(await getAWSResources(func));
        await checkLogGroupCleanedUp(func);
    },
    90 * 1000
);
