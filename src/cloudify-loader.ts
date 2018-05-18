import humanStringify from "human-stringify";
import { getOptions } from "loader-utils";
import * as path from "path";
import { log } from "./log";

export default function webpackCloudifyLoader(this: any, _source: string) {
    const options = getOptions(this);
    const fspath = path.join(__dirname, "functionserver.js");
    return `
        exports.trampoline = require("${fspath}").trampoline;
        require("${options.entry}");
    `;
}
