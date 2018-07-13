import { getOptions } from "loader-utils";

export interface CloudifyLoaderOptions {
    trampolineModule: string;
    functionModule?: string;
}

export default function webpackCloudifyLoader(this: any, _source: string) {
    const options = getOptions(this) as CloudifyLoaderOptions;
    let rv = `
        const trampolineModule = require("${options.trampolineModule}");
        module.exports = trampolineModule;
    `;
    if (options.functionModule !== undefined) {
        rv += `
            const functionExports = require("${options.functionModule}");
            trampolineModule.registerAllFunctions(functionExports);
        `;
    }
    return rv;
}
