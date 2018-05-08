import { cloudify, init } from "./client";
import { functionServer } from "./server";

function hello(name: string) {
    return `Hello ${name}!`;
}

function fact(n: number): number {
    return n <= 1 ? 1 : n * fact(n - 1);
}

async function client() {
    await init();
    const remoteHello = cloudify(hello);
    const response = await remoteHello("Andy");
    console.log(`response: ${response}`);
}

async function server() {
    functionServer.register(fact);
    functionServer.register(hello);
}
