import * as cloudify from "../src/cloudify";
import { checkResourcesCleanedUp, quietly, getAWSResources } from "../test/util";
import { getLogGroupName } from "../src/aws/aws-cloudify";
import * as functions from "./functions";

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
        await new Promise(resolve => {
            func.setLogger(str => str.match(/REPORT RequestId/) && resolve());
            remote.hello("gc-test");
        });

        await func.stop();
        const func2 = await cloud.createFunction("./functions", {
            gc: true,
            retentionInDays: 0
        });

        const { logGroupName } = func.state.resources;
        const { cloudwatch } = func.state.services;
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
