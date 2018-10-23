import { escape, stringify } from "querystring";

export function getLogGroupName(FunctionName: string) {
    return `/aws/lambda/${FunctionName}`;
}

export function getLogUrl(region: string, FunctionName: string) {
    const logGroupName = getLogGroupName(FunctionName);
    const params = stringify(
        {
            group: logGroupName
        },
        ";"
    );
    const rg = escape(region);
    return `https://${rg}.console.aws.amazon.com/cloudwatch/home?region=${rg}#logStream:${params}}`;
}

export function getExecutionUrl(
    region: string,
    logGroupName: string,
    logStreamName: string,
    executionId: string
) {
    const params = stringify(
        {
            group: logGroupName,
            stream: logStreamName,
            filter: `"${executionId}"`
        },
        ";"
    );
    const rg = escape(region);
    return `https://${rg}.console.aws.amazon.com/cloudwatch/home?region=${rg}#logEventViewer:${params}`;
}
