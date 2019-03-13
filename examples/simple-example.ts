import { faast } from "../index";
import * as funcs from "./functions";

async function main() {
    const cloudModule = await faast("aws", funcs, "./functions");
    console.log(`Log URL: ${cloudModule.logUrl()}`);
    const remote = cloudModule.functions;
    console.log(await remote.hello("world"));
    console.log(await remote.add(23, 19));
    await cloudModule.cleanup();
}

main();
