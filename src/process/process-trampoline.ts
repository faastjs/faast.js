import * as process from "process";
import { ProcessFunctionCall } from "./process-cloudify";
import { FunctionReturn } from "../shared";

process.on(
    "message",
    async ({
        call: { CallId, name, args },
        serverModule,
        timeout
    }: ProcessFunctionCall) => {
        const executionStart = Date.now();

        const timer = setTimeout(() => {
            process.disconnect();
            console.error(`Cloudify process timed out after ${timeout}s`);
            process.exit(-1);
        }, timeout * 1000);

        try {
            const mod = require(serverModule);
            if (!mod) {
                throw new Error(`Could not find module '${serverModule}'`);
            }
            const fn = mod[name];
            if (!fn) {
                throw new Error(
                    `Could not find function '${name}' in module '${serverModule}'`
                );
            }
            const rv = await fn(...args);
            const ret: FunctionReturn = {
                type: "returned",
                value: rv,
                CallId,
                executionStart,
                executionEnd: Date.now()
            };
            process.send!(ret);
        } catch (err) {
            const errObj = {};
            Object.getOwnPropertyNames(err).forEach(prop => (errObj[prop] = err[prop]));
            const errorReturn: FunctionReturn = {
                type: "error",
                value: errObj,
                CallId,
                executionStart,
                executionEnd: Date.now()
            };
            process.send!(errorReturn);
        } finally {
            clearTimeout(timer);
            process.disconnect();
        }
    }
);
