import { faast } from "../index";
import * as funcs from "./functions";

async function main() {
    const faastModule = await faast("aws", funcs, "./functions");
    console.log(`Log URL: ${faastModule.logUrl()}`);
    const remote = faastModule.functions;
    console.log(await remote.hello("world"));
    console.log(await remote.add(23, 19));
    await faastModule.cleanup();
}

main();
