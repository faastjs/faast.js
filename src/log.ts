import debug from "debug";
export const info = debug("cloudify:info");
export const warn = debug("cloudify:warning");
export const stats = debug("cloudify:stats");
export const logPricing = debug("cloudify:pricing");
export const logGc = debug("cloudify:gc");
export const logLeaks = debug("cloudify:leaks");
export const logTrampoline = debug("cloudify:trampoline");
export const logCalls = debug("cloudify:calls");
export const logWrapper = debug("cloudify:wrapper");
export const logWebpack = debug("cloudify:webpack");

warn.enabled = true;
stats.enabled = true;
logLeaks.enabled = true;
