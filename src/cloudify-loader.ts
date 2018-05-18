import humanStringify from "human-stringify";
import { getOptions } from "loader-utils";
import * as path from "path";
import { log } from "./log";

export default function webpackCloudifyLoader(this: any, source: string) {
    const options = getOptions(this);
    log(humanStringify(options));
    log(`RUNNING LOADER, source: ${source}, entry: ${options.entry}`);
    const fspath = path.join(__dirname, "functionserver.js");
    const rv = `
        exports.trampoline = require("${fspath}").trampoline;
        require("${options.entry}");
    `;
    log(rv);
    return rv;
}
