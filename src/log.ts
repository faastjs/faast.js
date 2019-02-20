import debug from "debug";
import { inspect } from "util";
export const info = debug("faast:info");
export const warn = debug("faast:warning");
export const logGc = debug("faast:gc");
export const logLeaks = debug("faast:leaks");
export const logCalls = debug("faast:calls");
export const logWebpack = debug("faast:webpack");
export const logProvider = debug("faast:provider");
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
