import debug from "debug";
export const log = debug("cloudify:info");
export const _warn = debug("cloudify:warning");
export const stats = debug("cloudify:stats");

_warn.enabled = true;

export function warn(formatter: any, ...args: any[]): void {
    _warn(formatter, ...args);
}

// Returns previous value;
export function disableWarnings(): boolean {
    const rv = _warn.enabled;
    _warn.enabled = false;
    return rv;
}

export function enableWarnings() {
    _warn.enabled = true;
}
