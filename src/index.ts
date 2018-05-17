import { initCloudify, cloudify, cleanupCloudify } from "./cloudify";
import { hello, fact, concat } from "./shared";
require("source-map-support").install();

async function client() {
    try {
        await initCloudify();
        const remoteHello = cloudify(hello);
        console.log(`hello("Andy"): ${await remoteHello("Andy")}`);
        const remoteFact = cloudify(fact);
        console.log(`fact(5): ${await remoteFact(5)}`);
        const remoteConcat = cloudify(concat);
        console.log(`concat("abc", "def"): ${await remoteConcat("abc", "def")}`);
        await cleanupCloudify();
    } catch (err) {
        console.log(err.stack);
    }
}

client();

export { trampoline } from "./functionserver";
