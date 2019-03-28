import { faast } from "../index";
import * as m from "./functions";

async function main() {
    const faastModule = await faast("aws", m, "./functions");

    const result = await faastModule.functions.hello("world");
    const cost = await faastModule.costSnapshot();

    console.log(`Result: ${result}\n`);
    console.log(`${cost}`);
    await faastModule.cleanup();
}

main();
