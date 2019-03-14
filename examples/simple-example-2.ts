import { faast } from "../index";
import * as m from "./functions";

async function main() {
    const faastModule = await faast("aws", m, "./functions");
    try {
        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push(faastModule.functions.hello("world"));
        }

        await Promise.all(promises);
    } finally {
        await faastModule.cleanup();
        console.log(`Cost estimate:`);
        console.log(`${await faastModule.costSnapshot()}`);
        console.log(`${(await faastModule.costSnapshot()).csv()}`);
    }
}

main();
