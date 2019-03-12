import { faast } from "../index";
import * as m from "./functions";

async function main() {
    const cloudFunc = await faast("aws", m, "./functions", {
        mode: "https"
    });

    const promises = [];
    for (let i = 0; i < 5; i++) {
        promises.push(cloudFunc.functions.hello("world"));
    }

    await Promise.all(promises);
    console.log(`Cost estimate:`);
    console.log(`${await cloudFunc.costSnapshot()}`);

    await cloudFunc.cleanup();
}

main();
