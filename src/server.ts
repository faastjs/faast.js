import { registerFunction, trampoline } from "./functionserver";
import { fact, hello } from "./shared";
import { Request, Response } from "express";

registerFunction(fact);
registerFunction(hello);
export { trampoline };
