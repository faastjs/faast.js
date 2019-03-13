import { faast } from "../index";
import * as m from "./functions";

async function main() {
    const cloudModule = await faast("aws", m, "./module");

    const result = await cloudModule.functions.hello("world");
    const cost = await cloudModule.costSnapshot();

    console.log(`Result: ${result}\n`);
    console.log(`${cost}`);
    await cloudModule.cleanup();
}

main();
