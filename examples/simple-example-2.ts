import { cloudify } from "../src/cloudify";
import * as m from "./module";
import { sleep } from "../src/shared";

async function main() {
    const { cloudFunc, remote } = await cloudify("aws", m, "./module", {
        useQueue: false
    });
    cloudFunc.setLogger(console.log);

    for (let i = 0; i < 5; i++) {
        console.log(await remote.hello("world"));
    }

    console.log(`Cost estimate:`);
    console.log(`${await cloudFunc.costEstimate()}`);

    console.log(`Waiting for logs...`);
    await sleep(60 * 1000);
    await cloudFunc.cleanup();
}

main();
