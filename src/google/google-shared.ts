import { stringify } from "querystring";

export function getLogUrl(project: string, functionName: string) {
    const params = stringify({
        project,
        resource: `cloud_function/function_name/${functionName}`
    });
    return `https://console.cloud.google.com/logs/viewer?${params}`;
}

export function getExecutionLogUrl(
    project: string,
    functionName: string,
    executionId: string
) {
    const params = stringify({
        project,
        resource: `cloud_function/function_name/${functionName}`,
        advancedFilter: `labels."execution_id"="${executionId}"`
    });
    return `https://console.cloud.google.com/logs/viewer?${params}`;
}
