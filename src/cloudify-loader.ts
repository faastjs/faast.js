import { getOptions } from "loader-utils";

export interface LoaderOptions {
    trampolineModule: string;
    functionModule: string;
}

export default function webpackCloudifyLoader(this: any, _source: string) {
    const options = getOptions(this) as LoaderOptions;
    let rv = `
            const trampolineModule = require("${options.trampolineModule}");
            module.exports = trampolineModule;
            const fModule = require("${options.functionModule}");
            trampolineModule.moduleWrapper.register(fModule);
            `;
    return rv;
}
