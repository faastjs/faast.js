import { VError } from "verror";

/**
 * A subclass of Error that is thrown by faast.js APIs.
 * @remarks
 * FError is a subclass of
 * {@link https://github.com/joyent/node-verror | VError}, which provides a
 * richer API for nested error handling. The main API is the same as the
 * standard Error class, namely the `message` `name`, and `stack` properties. In
 * addition, nested stack traces can be obtained with `VError.fullStack(err)`.
 * @public
 */
export class FError extends VError {
    name: string = "FaastError";
}
