import { cloudify } from "../src/cloudify";
import * as m from "./module";
import { sleep } from "../src/shared";

async function main() {
    const { cloudFunc, remote } = await cloudify("aws", m, "./module", {
        mode: "https"
    });

    const promises = [];
    for (let i = 0; i < 5; i++) {
        promises.push(remote.hello("world"));
    }

    await Promise.all(promises);
    console.log(`Cost estimate:`);
    console.log(`${await cloudFunc.costEstimate()}`);

    console.log(`Waiting for logs...`);
    await sleep(60 * 1000);
    await cloudFunc.cleanup();
}

main();
