import * as process from "process";
import { ProcessFunctionCall } from "./process-cloudify";
import { FunctionReturn } from "../shared";

process.on(
    "message",
    async ({ call: { CallId, name, args }, serverModule }: ProcessFunctionCall) => {
        const executionStart = Date.now();

        const mod = require(serverModule);
        const fn = mod[name];

        try {
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
        }
        process.disconnect();
    }
);
