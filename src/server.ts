import { registerFunction, trampoline } from "./functionserver";
import { fact, hello, concat } from "./shared";
import { Request, Response } from "express";

registerFunction(fact);
registerFunction(hello);
registerFunction(concat);
export { trampoline };
