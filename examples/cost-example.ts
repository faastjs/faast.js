import { faast } from "../index";
import * as m from "./functions";

async function main() {
    const cloudFunc = await faast("aws", m, "./module");

    const result = await cloudFunc.functions.hello("world");
    const cost = await cloudFunc.costEstimate();

    console.log(`Result: ${result}\n`);
    console.log(`${cost}`);
    await cloudFunc.cleanup();
}

main();
