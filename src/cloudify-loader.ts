import humanStringify from "human-stringify";
import { getOptions } from "loader-utils";
import * as path from "path";
import { log } from "./log";

export interface CloudifyLoaderOptions {
    trampolineModule: string;
    functionModule?: string;
}

export default function webpackCloudifyLoader(this: any, _source: string) {
    const options = getOptions(this) as CloudifyLoaderOptions;
    let rv = `
        const trampolineModule = require("${options.trampolineModule}");
        exports = trampolineModule;
    `;
    if (options.functionModule !== undefined) {
        rv += `
            const functionExports = require("${options.functionModule}");
            trampolineModule.registerAllFunctions(functionExports);
        `;
    }
    return rv;
}
