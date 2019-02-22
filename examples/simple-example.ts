import { faast } from "../src/faast";
import * as m from "./module";

async function main() {
    const cloudFunc = await faast("aws", m, "./module");
    const remote = cloudFunc.functions;
    const result = await remote.hello("world");

    console.log(`Result: ${result}`);
    await cloudFunc.cleanup();
}

main();
