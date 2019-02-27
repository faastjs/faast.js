import debug from "debug";
import { inspect } from "util";

/** @public */
export const info = debug("faast:info");
/** @public */
export const warn = debug("faast:warning");
/** @public */
export const logGc = debug("faast:gc");
/** @public */
export const logLeaks = debug("faast:leaks");
/** @public */
export const logCalls = debug("faast:calls");
/** @public */
export const logWebpack = debug("faast:webpack");
/** @public */
export const logProvider = debug("faast:provider");
/** @public */
export const logProviderSdk = debug("faast:providersdk");

function truncate(s: string, len: number) {
    return s.length > len ? `${s.substr(0, len)}...` : s;
}

export function inspectProvider(o: object) {
    if (!logProvider.enabled) {
        return "";
    }
    return truncate(inspect(o, false, 3).replace(/([ ][ ])/g, `. `), 1024);
}

warn.enabled = true;
logLeaks.enabled = true;
