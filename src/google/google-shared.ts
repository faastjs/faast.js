import { GaxiosError } from "gaxios";
import { URLSearchParams } from "url";

export function getLogUrl(project: string, functionName: string) {
    const params = new URLSearchParams({
        project,
        resource: `cloud_function/function_name/${functionName}`
    });
    return `https://console.cloud.google.com/logs/viewer?${params.toString()}`;
}

export function getExecutionLogUrl(
    project: string,
    functionName: string,
    executionId: string
) {
    const params = new URLSearchParams({
        project: project,
        resource: `cloud_function/function_name/${functionName}`,
        advancedFilter: `labels."execution_id"="${executionId}"`
    });
    return `https://console.cloud.google.com/logs/viewer?${params.toString()}`;
}

export const httpMethodsToRetry = ["POST", "PUT", "GET", "HEAD", "OPTIONS", "DELETE"];
export const statusCodesToRetry = [
    [100, 199],
    [429, 429],
    [405, 405],
    [500, 599]
];
/**
 * Determine based on config if we should retry the request.
 * @param err The GaxiosError passed to the interceptor.
 */
export function shouldRetryRequest(log: (msg: string) => void) {
    return (err: GaxiosError) => {
        const config = err?.config?.retryConfig;

        // If there's no config, or retries are disabled, return.
        if (!config || config.retry === 0) {
            return false;
        }

        // Check if this error has no response (ETIMEDOUT, ENOTFOUND, etc)
        if (
            !err.response &&
            (config.currentRetryAttempt || 0) >= config.noResponseRetries!
        ) {
            return false;
        }

        // Don't retry if the request is aborted deliberately.
        if (err.name === "AbortError") {
            return false;
        }

        // Only retry with configured HttpMethods.
        if (
            !err.config.method ||
            httpMethodsToRetry.indexOf(err.config.method.toUpperCase()) < 0
        ) {
            return false;
        }

        // If this wasn't in the list of status codes where we want
        // to automatically retry, return.
        if (err.response?.status) {
            let isInRange = false;
            const status = err.response.status;
            for (const [min, max] of statusCodesToRetry!) {
                if (status >= min && status <= max) {
                    isInRange = true;
                    break;
                }
            }
            if (!isInRange) {
                return false;
            }
        }

        // If we are out of retry attempts, return
        config.currentRetryAttempt = config.currentRetryAttempt || 0;
        if (config.currentRetryAttempt >= config.retry!) {
            return false;
        }

        log(
            `google: attempts: ${config.currentRetryAttempt}/${config.retry}, code: ${err.code}, status: ${err.response?.status} name: ${err.name}, message: ${err.message}`
        );

        return true;
    };
}
