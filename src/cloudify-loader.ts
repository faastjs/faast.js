import humanStringify from "human-stringify";
import { getOptions } from "loader-utils";
import * as path from "path";
import { log } from "./log";

export default function webpackCloudifyLoader(this: any, _source: string) {
    const options = getOptions(this);
    return `
        const trampolineModule = require("${options.trampoline}");
        const entryExports = require("${options.entry}");
        trampolineModule.registerAllFunctions(entryExports);
        exports.trampoline = trampolineModule.trampoline;
    `;
}
