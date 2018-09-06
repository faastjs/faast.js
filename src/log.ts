import debug from "debug";
export const log = debug("cloudify:info");
export const warn = debug("cloudify:warning");
export const stats = debug("cloudify:stats");
export const logPricing = debug("cloudify:pricing");

warn.enabled = true;

// Returns previous value;
export function disableWarnings(): boolean {
    const rv = warn.enabled;
    warn.enabled = false;
    return rv;
}

export function enableWarnings() {
    warn.enabled = true;
}
