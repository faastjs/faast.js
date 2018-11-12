import { getOptions } from "loader-utils";
import { ModuleWrapperOptions } from "./module-wrapper";

export interface LoaderOptions {
    trampolineFactoryModule: string;
    functionModule: string;
    moduleWrapperOptions: ModuleWrapperOptions;
}

export default function webpackCloudifyLoader(this: any, _source: string) {
    const options = getOptions(this) as LoaderOptions;
    let rv = `
            const trampolineFactory = require("${options.trampolineFactoryModule}");
            const fModule = require("${options.functionModule}");
            const ModuleWrapper = require("${require.resolve("./module-wrapper")}");
            const wrappedModule = new ModuleWrapper(fModule, ${JSON.stringify(
                options.moduleWrapperOptions
            )});
            module.exports = trampolineFactory.makeTrampoline(wrappedModule);
            `;
    return rv;
}
