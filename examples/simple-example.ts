import { faast } from "../src/faast";
import * as funcs from "./functions";

async function main() {
    const cloudFunc = await faast("aws", funcs, "./functions");
    console.log(`Log URL: ${cloudFunc.logUrl()}`);
    const remote = cloudFunc.functions;
    console.log(await remote.hello("world"));
    console.log(await remote.add(23, 19));
    await cloudFunc.cleanup();
}

main();
