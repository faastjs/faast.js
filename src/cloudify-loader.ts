import { getOptions } from "loader-utils";

export interface ImmediateLoaderOptions {
    type: "immediate";
    trampolineModule: string;
    functionModule: string;
}

export interface ParentLoaderOptions {
    type: "parent";
    trampolineModule: string;
}

export interface ChildLoaderOptions {
    type: "child";
    moduleWrapper: string;
    functionModule: string;
}

export type LoaderOptions =
    | ImmediateLoaderOptions
    | ParentLoaderOptions
    | ChildLoaderOptions;

export default function webpackCloudifyLoader(this: any, _source: string) {
    const options = getOptions(this) as LoaderOptions;
    if (options.type === "immediate" || options.type === "parent") {
        let rv = `
            const trampolineModule = require("${options.trampolineModule}");
            module.exports = trampolineModule;
        `;
        if (options.type === "immediate") {
            rv += `
                const fModule = require("${options.functionModule}");
                trampolineModule.moduleWrapper.register(fModule);
            `;
        }
        return rv;
    } else if (options.type === "child") {
        return `
            const process = require("process");
            const ModuleWrapper = require("${options.moduleWrapper}").ModuleWrapper;
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
                }
            });
        `;
    }
    return "";
}
