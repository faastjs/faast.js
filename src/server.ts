import { Request, Response } from "express";
import { initializeGoogleAPIs } from "./shared";

interface FunctionCall {
    name: string;
    args: any[];
}

interface FunctionReturn {
    type: "returned" | "error";
    message?: string;
    value?: string;
}

interface FunctionEntry {
    name: string;
    fn: Function;
}

type AnyFunction = (...args: any[]) => any;

class FunctionServer {
    funcs: FunctionEntry[] = [];

    validate(request: Request): FunctionCall {
        // XXX
        return request.body;
    }

    async handle(request: Request, response: Response) {
        try {
            console.log(`FunctionServer request: ${request.originalUrl}`);
            const call = this.validate(request);
            if (!call) {
                throw new Error("Invalid function call request");
            }

            const fn = this.funcs[call.name];
            if (!fn) {
                throw new Error(`Function named "${call.name}" not found`);
            }

            const rv = await fn.call(call.args);

            response.send({
                type: "returned",
                value: JSON.stringify(rv)
            } as FunctionReturn);
            response.end();
        } catch (err) {
            response.send({
                type: "error",
                message: err.stack
            } as FunctionReturn);
        }
    }

    register<A, R>(fn: (arg: A) => R, name?: string) {
        name = name || fn.name;
        if (!name) {
            throw new Error("Could not register function without name");
        }
        this.funcs[name] = fn;
    }
}

export const functionServer = new FunctionServer();

export async function trampoline(request: Request, response: Response) {
    await functionServer.handle(request, response);
}
