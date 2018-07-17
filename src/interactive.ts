import * as repl from "repl";
import * as cloudify from "./cloudify";
import { exec } from "./interactive-function";

type Callback = (err: Error | null, value: string) => void;

async function interactive(cloudProvider: cloudify.CloudProvider) {
    const cloud = cloudify.create(cloudProvider);
    const func = await cloud.createFunction("./interactive-function", {
        useQueue: false,
        memorySize: 512,
        timeout: 300
    });
    const remoteExec = func.cloudify(exec);

    async function evaluator(
        cmd: string,
        _context: any,
        _filename: string,
        callback: Callback
    ) {
        callback(null, await remoteExec(cmd));
    }

    function writer(str: string) {
        return str;
    }

    repl.start({ prompt: "> ", eval: evaluator, writer }).on("exit", async () => {
        await func.cleanup();
    });
}

interactive("aws");
