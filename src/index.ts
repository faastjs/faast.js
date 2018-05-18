import { cleanupCloudify, cloudify, initCloudify, cloudifyAll } from "./cloudify";
require("source-map-support").install();
import * as server from "./server";

const { hello, concat, fact } = cloudifyAll(server);

async function client() {
    try {
        await initCloudify("./server");

        console.log(`hello("Andy"): ${await hello("Andy")}`);
        console.log(`fact(5): ${await fact(5)}`);
        console.log(`concat("abc", "def"): ${await concat("abc", "def")}`);

        await cleanupCloudify();
    } catch (err) {
        console.log(err.stack);
    }
}

client();
