import humanStringify from "human-stringify";
import { getOptions } from "loader-utils";
import * as path from "path";
import { log } from "./log";

export default function webpackCloudifyLoader(this: any, _source: string) {
    const options = getOptions(this);
    const fspath = path.join(__dirname, "functionserver.js");
    return `
        const functionServer = require("${fspath}");
        exports.trampoline = functionServer.trampoline;
        const entryExports = require("${options.entry}");
        for(const name of Object.keys(entryExports)) {
            if(typeof entryExports[name] === "function") {
                console.log(\`Registering function "\${name}"\`);
                functionServer.registerFunction(entryExports[name]);
            }
        }
    `;
}
