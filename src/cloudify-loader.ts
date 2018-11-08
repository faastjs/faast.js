import { getOptions } from "loader-utils";

export interface CloudifyLoaderOptions {
    type: "trampoline" | "parent" | "child";
    trampolineModule: string;
    functionModule: string;
}

export default function webpackCloudifyLoader(this: any, _source: string) {
    const options = getOptions(this) as CloudifyLoaderOptions;
    if (options.type === "trampoline") {
        const rv = `
        const trampolineModule = require("${options.trampolineModule}");
        module.exports = trampolineModule;
        const fModule = require("${options.functionModule}");
        trampolineModule.moduleWrapper.register(fModule);
        `;
        return rv;
    } else if (options.type === "child") {
        const rv = `
            const process = require("process");
            const ModuleWrapper = require("${options.trampolineModule}").ModuleWrapper;
            export const moduleWrapper = new ModuleWrapper();
            const fModule = require("${options.functionModule}");
            moduleWrapper.register(fModule);
            process.on("message", async (call) => {
                const startTime = Date.now();
                try {
                    const ret = await moduleWrapper.execute({ call, startTime });
                    process.send(ret);
                } catch (err) {
                    console.error(err);
                } // finally {
                  //  process.disconnect();
                  // }
            });
        `;
        return rv;
    }
    return "";
}
