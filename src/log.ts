import debug from "debug";
export const info = debug("faast:info");
export const warn = debug("faast:warning");
export const stats = debug("faast:stats");
export const logPricing = debug("faast:pricing");
export const logGc = debug("faast:gc");
export const logLeaks = debug("faast:leaks");
export const logTrampoline = debug("faast:trampoline");
export const logCalls = debug("faast:calls");
export const logWrapper = debug("faast:wrapper");
export const logWebpack = debug("faast:webpack");
export const logQueue = debug("faast:queue");
export const logProvider = debug("faast:provider");

warn.enabled = true;
stats.enabled = true;
logLeaks.enabled = true;
