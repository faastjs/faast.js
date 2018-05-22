import { CloudifyGoogle, CloudifyAWS } from "./cloudify";
import * as server from "./server";
require("source-map-support").install();

const log = console.log;

async function client() {
    // const cloudFunctionServer = await CloudifyGoogle.create("./server");
    const cloudFunctionServer = await CloudifyAWS.create("./server");
    try {
        const { hello, concat, fact, error, noargs } = cloudFunctionServer.cloudifyAll(
            server
        );

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
    await cloudFunctionServer.cleanup();
}

client().catch(err => console.log(err));
