import { faast } from "faastjs";
import * as m from "./functions";

async function main(n: number) {
    console.log(`Executing ${n} calls`);
    const faastModule = await faast("aws", m);
    try {
        const promises = [];
        for (let i = 0; i < n; i++) {
            promises.push(faastModule.functions.hello("world"));
        }

        await Promise.all(promises);
    } finally {
        await faastModule.cleanup();
        console.log(`Cost estimate:`);
        console.log(`${await faastModule.costSnapshot()}`);
    }
}

main(Number(process.argv[2]));
