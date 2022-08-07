import debug from "debug";
import { inspect } from "util";

/**
 * Faast.js loggers.
 * @remarks
 * Unless otherwise specified, each log is disabled by default unless the value
 * of the DEBUG environment variable is set to the corresponding value. For
 * example:
 *
 * ```
 *   $ DEBUG=faast:info,faast:provider <cmd>
 *   $ DEBUG=faast:* <cmd>
 * ```
 *
 * Logs can also be enabled or disabled programmatically:
 * ```typescript
 * import { log } from "faastjs"
 * log.info.enabled = true;
 * log.provider.enabled = true;
 * ```
 *
 * Each log outputs specific information:
 *
 * `info` - General informational logging.
 *
 * `minimal` - Outputs only basic information like the function name created in
 * the cloud.
 *
 * `warn` - Warnings. Enabled by default.
 *
 * `gc` - Garbage collection verbose logging.
 *
 * `leaks` - Memory leak detector warnings for the cloud function. Enabled by
 * default.
 *
 * `calls` - Verbose logging of each faast.js enabled function invocation.
 *
 * `webpack` - Verbose logging from webpack and packaging details.
 *
 * `provider` - Verbose logging of each interaction between faast.js runtime and
 * the provider-specific implementation.
 *
 * `awssdk` - Verbose logging of AWS SDK. This can be useful for identifying
 * which API calls are failing, retrying, or encountering rate limits.
 *
 * @public
 */
export const log = {
    info: debug("faast:info"),
    minimal: debug("faast:minimal"),
    warn: debug("faast:warning"),
    gc: debug("faast:gc"),
    leaks: debug("faast:leaks"),
    calls: debug("faast:calls"),
    webpack: debug("faast:webpack"),
    provider: debug("faast:provider"),
    awssdk: debug("faast:awssdk")
};

/* istanbul ignore next  */
function truncate(s: string, len: number) {
    return s.length > len ? `${s.substr(0, len)}...` : s;
}

export function inspectProvider(o: object) {
    if (!log.provider.enabled) {
        return "";
    }
    /* istanbul ignore next  */
    return truncate(inspect(o, false, 3), 1024);
}

log.warn.enabled = true;
log.leaks.enabled = true;
