import { faastify } from "../src/faast";
import * as m from "./module";

async function main() {
    const cloudFunc = await faastify("aws", m, "./module");

    const result = await cloudFunc.functions.hello("world");

    console.log(`Result: ${result}`);
    await cloudFunc.cleanup();
}

main();
