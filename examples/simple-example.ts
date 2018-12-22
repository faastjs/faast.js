import { faastify } from "../src/faast";
import * as m from "./module";

async function main() {
    const { cloudFunc, remote } = await faastify("aws", m, "./module");

    const result = await remote.hello("world");

    console.log(`Result: ${result}`);
    await cloudFunc.cleanup();
}

main();
