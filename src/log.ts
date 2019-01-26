import debug from "debug";
import { inspect } from "util";
export const info = debug("faast:info");
export const warn = debug("faast:warning");
export const stats = debug("faast:stats");
export const logPricing = debug("faast:pricing");
export const logGc = debug("faast:gc");
export const logLeaks = debug("faast:leaks");
export const logCalls = debug("faast:calls");
export const logWebpack = debug("faast:webpack");
export const logProvider = debug("faast:provider");

export function inspectProvider(o: object) {
    if (!logProvider.enabled) {
        return "";
    }
    return inspect(o, false, 3).replace(/\n([ ]*)/g, `\n${String.fromCharCode(24)}$1`);
}

warn.enabled = true;
stats.enabled = true;
logLeaks.enabled = true;
