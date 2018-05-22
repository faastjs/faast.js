import { CloudifyGoogle, CloudifyAWS, CloudFunctionService } from "./cloudify";
import * as server from "./server";

const log = console.log;

export async function client(service: CloudFunctionService) {
    try {
        const { hello, concat, fact, error, noargs, async, path } = service.cloudifyAll(
            server
        );

        log(`Service: ${service.name}`);

        log(`hello("Andy"): ${await hello("Andy")}`);
        log(`fact(5): ${await fact(5)}`);
        log(`concat("abc", "def"): ${await concat("abc", "def")}`);

        try {
            log(`error("hey"): ${await error("hey")}`);
        } catch (err) {
            log(err.message);
        }

        log(`noargs(): ${await noargs()}`);

        log(`async(): ${await async()}`);
        log(`path(): ${await path()}`);
    } catch (err) {
        log(err.stack);
    }
    await service.cleanup();
}

function logErrors(err: Error) {
    console.log(err);
}

export async function runClients() {
    let requests = [
        CloudifyGoogle.create("./server").then(client),
        CloudifyAWS.create("./server").then(client)
    ];
    await Promise.all(requests);
}
