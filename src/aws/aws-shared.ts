import { URLSearchParams } from "url";

export function getLogGroupName(FunctionName: string) {
    return `/aws/lambda/${FunctionName}`;
}

export function getLogUrl(region: string, FunctionName: string) {
    const logGroupName = getLogGroupName(FunctionName);
    const group = encodeURIComponent(logGroupName);
    const rg = encodeURIComponent(region);

    return `https://console.aws.amazon.com/cloudwatch/home?region=${rg}#logsV2:log-groups/log-group/${group}`;
}

export function getExecutionLogUrl(
    region: string,
    logGroupName: string,
    logStreamName: string
) {
    const rg = encodeURIComponent(region);
    const group = encodeURIComponent(logGroupName);
    const stream = encodeURIComponent(logStreamName);
    return `https://console.aws.amazon.com/cloudwatch/home?region=${rg}#logsV2:log-groups/log-group/${group}/log-events/${stream}`;
}
