import { stringify } from "querystring";
import { GaxiosError } from "gaxios";

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

export const httpMethodsToRetry = ["POST", "PUT", "GET", "HEAD", "OPTIONS", "DELETE"];
export const statusCodesToRetry = [[100, 199], [429, 429], [405, 405], [500, 599]];

function getGaxiosRetryConfig(err: GaxiosError) {
    if (err && err.config && err.config.retryConfig) {
        return err.config.retryConfig;
    }
    return;
}

/**
 * Determine based on config if we should retry the request.
 * @param err The GaxiosError passed to the interceptor.
 */
export function shouldRetryRequest(log: (msg: string) => void) {
    return (err: GaxiosError) => {
        const config = getGaxiosRetryConfig(err);

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
        if (err.response && err.response.status) {
            let isInRange = false;
            for (const [min, max] of statusCodesToRetry!) {
                const status = err.response.status;
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
            `google: attempts: ${config.currentRetryAttempt}/${config.retry}, code: ${
                err.code
            }, status: ${err.response && err.response.status} name: ${
                err.name
            }, message: ${err.message}`
        );

        return true;
    };
}
