import { VError } from "verror";
import { log } from "./log";

/**
 * A subclass of Error that is thrown by faast.js APIs and cloud function
 * invocations.
 * @remarks
 * `FaastError` is a subclass of
 * {@link https://github.com/joyent/node-verror | VError}, which provides an API
 * for nested error handling. The main API is the same as the standard Error
 * class, namely the {@link FaastError.message}, {@link FaastError.name}, and
 * {@link FaastError.stack} properties. In addition, the
 * {@link FaastError.fullStack} property provides a more detailed stack trace.
 *
 * `FaastError` can be returned in two situations. In the first situation,
 * faast.js itself is reporting an error when it encounters a situation it
 * cannot handle. In the second situation, the user's cloud function is throwing
 * an error (or returning a rejected `Promise`). In the second situation, the
 * original error class is not re-created on the client side because faast.js
 * cannot reliably instantiate foreign subclasses of `Error`. Instead, all of
 * the properties of the `Error` on the remote side are serialized and sent to
 * the local side. These properties are available on the {@link FaastError.info}
 * object. In addition, {@link FaastError.functionName} is the name of the
 * function that was invoked, and {@link FaastError.args} are the arguments used
 * to invoke the function that caused the error.
 *
 * If available, {@link FaastError.logUrl} will be a URL pointing to the logs
 * for the specific invocation that caused the error. The `logUrl` will be
 * appended to the end of {@link FaastError.message} and
 * {@link FaastError.fullStack} as well. `logUrl` be surrounded by whilespace on
 * both sides to ease parsing as a URL by IDEs.
 * @public
 */
export class FaastError extends VError {
    /** Always `"FaastError"` */
    name: string = "FaastError";

    /**
     * The log URL if this `FaastError` was caused by a cloud function
     * invocation exception. The url will have a space at the beginning and end.
     */
    logUrl?: string;

    /**
     * @internal
     */
    _isTimeout: boolean | undefined;

    /**
     * True if the error is caused by a cloud function timeout.
     */
    get isTimeout(): boolean {
        if (this._isTimeout) {
            return true;
        }
        const { cause } = this;
        return cause && cause instanceof FaastError && cause.isTimeout;
    }

    /**
     * The error message. If nested errors occurred, this message summarizes all
     * nested errors separated with colons (:).
     */
    get message() {
        return super.message;
    }

    set message(value: string) {
        super.message = value;
    }

    /**
     * Error code, if any.
     */
    code?: string;

    /**
     * The stack trace for the error without include traces for underlying
     * errors. A more complete stack trace is available under
     * {@link FaastError.fullStack}.
     */
    stack: string | undefined;

    /**
     * The full stack trace including stack traces for underlying causes, if
     * any.
     */
    get fullStack(): string {
        return VError.fullStack(this);
    }

    /**
     * Get additional metadata about this error. For errors returned from a
     * remote cloud function call, the returned object will contain all of the
     * properties from the original error on the remote side.
     */
    get info(): { [key: string]: any } {
        return VError.info(this);
    }

    /**
     * The underlying cause of the error, if any. This cause is also reflected
     * in {@link FaastError.message} and {@link FaastError.fullStack}.
     */
    cause(): Error | undefined {
        return super.cause();
    }

    /**
     * For errors returned from a cloud function call, this is the function name
     * that was invoked that caused the error.
     */
    functionName?: string;

    /**
     * For errors returned from a cloud function call, these are the arguments
     * that caused the failed invocation.
     */
    args?: any[];
}

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
    if (logUrl) {
        underlying = new FaastError("%s", logUrl);
        underlying.stack = `${underlying}
    at ${functionName} (faast.js cloud function invocation)`;
    }
    const error = new FaastError(
        {
            cause: underlying,
            info: errObj
        },
        "%s",
        errObj.message
    );
    error.stack = errObj.stack;
    error.code = errObj.code;
    error.functionName = functionName;
    error.args = args;
    error._isTimeout = errObj._isTimeout;

    // Surround the logUrl with spaces because URL links are broken in vscode if
    // there's no whitespace surrounding the URL.
    error.logUrl = ` ${logUrl} `;
    if (Object.keys(errObj).length === 0 && !(errObj instanceof Error)) {
        log.warn(
            `Error response object has no keys, likely a bug in faast (not serializing error objects)`
        );
    }
    return error;
}
