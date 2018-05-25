import { Request, Response } from "express";
import humanStringify from "human-stringify";
import MemoryFileSystem = require("memory-fs");
import archiver = require("archiver");
import nodeExternals = require("webpack-node-externals");
import { AnyFunction, FunctionCall, FunctionReturn } from "../cloudify";
import * as aws from "aws-sdk";

const funcs: { [func: string]: AnyFunction } = {};

export function registerFunction(fn: AnyFunction, name?: string) {
    name = name || fn.name;
    if (!name) {
        throw new Error("Could not register function without name");
    }
    funcs[name] = fn;
}

export function registerAllFunctions(obj: { [name: string]: AnyFunction }) {
    for (const name of Object.keys(obj)) {
        registerFunction(obj[name], name);
    }
}

export async function trampoline(
    event: any,
    _context: any,
    callback: (err: Error | null, obj: object) => void
) {
    console.log(`${humanStringify(event)}`);
    try {
        const { name, args } = event as FunctionCall;
        if (!name) {
            throw new Error("Invalid function call request");
        }

        const func = funcs[name];
        if (!func) {
            throw new Error(`Function named "${name}" not found`);
        }

        if (!args) {
            throw new Error("Invalid arguments to function call");
        }

        console.log(`func: ${name}, args: ${humanStringify(args)}`);

        const rv = await func.apply(undefined, args);

        callback(null, {
            type: "returned",
            value: rv
        } as FunctionReturn);
    } catch (err) {
        const errObj = {};
        Object.getOwnPropertyNames(err).forEach(name => (errObj[name] = err[name]));
        console.log(`errObj: ${humanStringify(errObj)}`);
        callback(null, {
            type: "error",
            value: errObj
        } as FunctionReturn);
    }
}
