import { cleanupCloudify, cloudify, initCloudify } from "./cloudify";
import { hello, fact, concat } from "./server";
require("source-map-support").install();

async function client() {
    try {
        await initCloudify("./server");

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
