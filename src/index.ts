import { cleanupCloudify, cloudifyAll, initCloudify } from "./cloudify";
import * as server from "./server";
require("source-map-support").install();

const { hello, concat, fact, error, noargs } = cloudifyAll(server);

const log = console.log;

async function client() {
    try {
        await initCloudify("./server");

        log(`hello("Andy"): ${await hello("Andy")}`);
        log(`fact(5): ${await fact(5)}`);
        log(`concat("abc", "def"): ${await concat("abc", "def")}`);

        try {
            log(`error("hey"): ${await error("hey")}`);
        } catch (err) {
            log(err.message);
        }

        log(`noargs(): ${await noargs()}`);
    } catch (err) {
        log(err.stack);
    }

    await cleanupCloudify().catch(err => log(err.stack));
}

client();
