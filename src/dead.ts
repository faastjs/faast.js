// XXX Consider adding a cloudwatch event to clean up, which will happen in the background.
// export async function addCleanupEvent(
//     FunctionArn: string,
//     events: aws.CloudWatchEvents
// ) {
//     const ruleDescription = await events
//         .describeRule({ Name: "faast-cleanup" })
//         .promise();
//     let RuleArn = ruleDescription.Arn;
//     if (!RuleArn) {
//         const ruleResponse = await events
//             .putRule({ Name: "faast-cleanup", ScheduleExpression: "rate(1 day)" })
//             .promise();
//         RuleArn = ruleResponse.RuleArn;
//         events.putTargets({
//             Rule: "faast-cleanup-schedule",
//             Targets: [{ Arn: FunctionArn, Id: "faast-cleanup" }]
//         });
//     }
// }

// function addEventInvokePermissionsToFunction(
//     FunctionName: string,
//     EventRuleArn: string,
//     lambda: aws.Lambda
// ) {
//     return retry(3, () =>
//         lambda
//             .addPermission({
//                 FunctionName,
//                 Action: "lambda:InvokeFunction",
//                 Principal: "events.amazonaws.com",
//                 StatementId: `${FunctionName}-Cleanup`,
//                 SourceArn: EventRuleArn
//             })
//             .promise()
//     );
// }

// XXX Don't technically need this, but it might be good to proactively clean up subscriptions.
// async function getSNSSubscriptionArns(sns: aws.SNS, TopicArn: string) {
//     const response = await sns.listSubscriptionsByTopic({ TopicArn }).promise();
//     return (response.Subscriptions || []).map(s => s.SubscriptionArn!);
// }
