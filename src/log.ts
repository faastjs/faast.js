import debug from "debug";
import { inspect } from "util";

/**
 * Faast.js loggers.
 * @remarks
 * Unless otherwise specified, each log is disabled by default unless the value
 * of the DEBUG environment variable is set to the corresponding value. For example:
 *
 * ```
 *   $ DEBUG=faast:info,faast:provider <cmd>
 *   $ DEBUG=faast:* <cmd>
 * ```
 *
 * @public
 */
export const log = {
    /** General informational logging. */
    info: debug("faast:info"),
    /** Warnings. Enabled by default. */
    warn: debug("faast:warning"),
    /** Garbage collection verbose logging. */
    gc: debug("faast:gc"),
    /** Memory leak detector warnings for the remote function. Enabled by default. */
    leaks: debug("faast:leaks"),
    /** Verbose logging of each faast.js enabled function invocation. */
    calls: debug("faast:calls"),
    /** Verbose logging from webpack and packaging details. */
    webpack: debug("faast:webpack"),
    /**
     * Verbose logging of each interaction between faast.js runtime and the
     * provider-specific implementation.
     */
    provider: debug("faast:provider"),
    /** Verbose logging of AWS SDK. */
    awssdk: debug("faast:awssdk")
};

function truncate(s: string, len: number) {
    return s.length > len ? `${s.substr(0, len)}...` : s;
}

export function inspectProvider(o: object) {
    if (!log.provider.enabled) {
        return "";
    }
    return truncate(inspect(o, false, 3).replace(/([ ][ ])/g, `. `), 1024);
}

log.warn.enabled = true;
log.leaks.enabled = true;
