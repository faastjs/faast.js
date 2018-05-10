import { cloudify, init, cleanup } from "./cloudify";
import { hello, fact, concat } from "./shared";

async function client() {
    await init();
    const remoteHello = cloudify(hello);
    console.log(`hello("Andy"): ${await remoteHello("Andy")}`);
    const remoteFact = cloudify(fact);
    console.log(`fact(5): ${await remoteFact(5)}`);
    const remoteConcat = cloudify(concat);
    console.log(`concat("abc", "def"): ${await remoteConcat("abc", "def")}`);
    await cleanup();
}

client();
