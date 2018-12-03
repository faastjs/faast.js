import { getOptions } from "loader-utils";
import { WrapperOptions } from "./wrapper";
import { logTrampoline } from "./log";

export interface LoaderOptions {
    trampolineFactoryModule: string;
    functionModule: string;
    moduleWrapperOptions: WrapperOptions;
}

export default function webpackCloudifyLoader(this: any, _source: string) {
    const options = getOptions(this);
    const rv = `
            const trampolineFactory = require(${options.trampolineFactoryModule});
            const fModule = require(${options.functionModule});
            const ModuleWrapper = require("${require.resolve(
                "./module-wrapper"
            )}").ModuleWrapper;
            const wrappedModule = new ModuleWrapper(fModule, ${
                options.moduleWrapperOptions
            });
            module.exports = trampolineFactory.makeTrampoline(wrappedModule);
    `;
    logTrampoline(rv);
    return rv;
}
