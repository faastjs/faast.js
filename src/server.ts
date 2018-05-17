import { registerFunction, trampoline } from "./functionserver";
import { fact, hello, concat } from "./shared";
import { Request, Response } from "express";
import debug from "debug";

const log = debug("cloudify");

registerFunction(fact);
registerFunction(hello);
registerFunction(concat);
log(`Registered functions`);

export function serverFile() {
    return __filename;
}

export { trampoline };
