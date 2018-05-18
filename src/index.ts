import { cleanupCloudify, cloudifyAll, initCloudify } from "./cloudify";
import * as server from "./server";
require("source-map-support").install();

const { hello, concat, fact, error } = cloudifyAll(server);

async function client() {
    try {
        await initCloudify("./server");

        console.log(`hello("Andy"): ${await hello("Andy")}`);
        console.log(`fact(5): ${await fact(5)}`);
        console.log(`concat("abc", "def"): ${await concat("abc", "def")}`);

        console.log(`error: ${await error("hey")}`);

        await cleanupCloudify();
    } catch (err) {
        console.log(err.stack);
    }
}

client();
