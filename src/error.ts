import { VError } from "verror";
import { log } from "./log";

/**
 * Possible FaastError names. See {@link FaastError}. To test for errors
 * matching these names, use the static method
 * {@link FaastError}.hasCauseWithName().
 * @public
 */
export enum FaastErrorNames {
    /** Generic error. See {@link FaastError}. */
    EGENERIC = "VError",
    /** The arguments passed to the cloud function could not be serialized without losing information.  */
    ESERIALIZE = "FaastSerializationError",
    /** The remote cloud function timed out. */
    ETIMEOUT = "FaastTimeoutError",
    /** The remote cloud function exceeded memory limits. */
    EMEMORY = "FaastOutOfMemoryError",
    /** The function invocation was cancelled by user request. */
    ECANCEL = "FaastCancelError",
    /** The exception was thrown by user's remote code, not by faast.js or the cloud provider. */
    EEXCEPTION = "UserException",
    /** Could not create the remote cloud function or supporting infrastructure. */
    ECREATE = "FaastCreateFunctionError",
    /** The remote cloud function failed to execute because of limited concurrency. */
    ECONCURRENCY = "FaastConcurrencyError"
}

/**
 * FaastError is a subclass of VError (https://github.com/joyent/node-verror).
 * that is thrown by faast.js APIs and cloud function invocations.
 * @remarks
 * `FaastError` is a subclass of
 * {@link https://github.com/joyent/node-verror | VError}, which provides an API
 * for nested error handling. The main API is the same as the standard Error
 * class, namely the err.message, err.name, and err.stack properties.
 *
 * Several static methods on {@link FaastError} are inherited from VError:
 *
 * FaastError.fullStack(err) - property provides a more detailed stack trace
 * that include stack traces of causes in the causal chain.
 *
 * FaastError.info(err) - returns an object with fields `functionName`, `args`,
 * and `logUrl`. The `logUrl` property is a URL pointing to the logs for a
 * specific invocation that caused the error.`logUrl` will be surrounded by
 * whitespace on both sides to ease parsing as a URL by IDEs.
 *
 * FaastError.hasCauseWithName(err, cause) - returns true if the FaastError or
 * any of its causes includes an error with the given name, otherwise false. All
 * of the available names are in the enum {@link FaastErrorNames}. For example,
 * to detect if a FaastError was caused by a cloud function timeout:
 *
 * ```typescript
 *   FaastError.hasCauseWithName(err, FaastErrorNames.ETIMEOUT)
 * ```
 *
 * FaastError.findCauseByName(err, cause) - like FaastError.hasCauseWithName()
 * except it returns the Error in the causal chain with the given name instead
 * of a boolean, otherwise null.
 *
 * @public
 */
export class FaastError extends VError {}

export function synthesizeFaastError({
    errObj,
    logUrl,
    functionName,
    args
}: {
    errObj: any;
    logUrl?: string;
    functionName?: string;
    args?: any[];
}) {
    let underlying;
    if (logUrl || functionName || args) {
        underlying = new FaastError(
            { name: FaastErrorNames.EEXCEPTION, info: { logUrl, functionName, args } },
            "%s",
            logUrl ?? "user exception"
        );
        underlying.stack = `${underlying}
    at ${functionName} (faast.js cloud function invocation)`;
    }
    const error = new FaastError(
        {
            cause: underlying,
            info: errObj,
            name: errObj.name
        },
        "%s",
        errObj.message
    );
    if (errObj.stack) {
        error.stack = errObj.stack;
    }
    // Surround the logUrl with spaces because URL links are broken in vscode if
    // there's no whitespace surrounding the URL.
    if (Object.keys(errObj).length === 0 && !(errObj instanceof Error)) {
        log.warn(
            `Error response object has no keys, likely a bug in faast (not serializing error objects)`
        );
    }
    return error;
}
