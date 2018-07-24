import debug from "debug";
export const log = debug("cloudify:info");
export const warn = debug("cloudify:warning");
export const error = debug("cloudify:error");
export const stats = debug("cloudify:stats");

warn.enabled = true;
error.enabled = true;
